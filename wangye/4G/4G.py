# -*- coding: utf-8 -*-
import eventlet
eventlet.monkey_patch()

import copy
import json
import math
import os
import re
import socket
import threading
import time
from pathlib import Path

from flask import Flask, jsonify, request
from flask_cors import CORS
from flask_sock import Sock
from gnss_filter import GnssService

GNSS_STATE_DIR = Path(os.environ.get('STM32_GNSS_STATE_DIR', '').strip() or Path(__file__).with_name('gnss_runtime'))
gnss_service = GnssService(GNSS_STATE_DIR)


def _environment_port(name, default):
    raw = os.environ.get(name, str(default)).strip()
    try:
        port = int(raw)
    except ValueError as exc:
        raise ValueError(f"{name} must be an integer") from exc
    if not 1 <= port <= 65535:
        raise ValueError(f"{name} must be between 1 and 65535")
    return port


HTTP_PORT = _environment_port("STM32_HTTP_PORT", 8007)
DEVICE_TCP_PORT = _environment_port("STM32_TCP_PORT", 8008)

app = Flask(__name__)
allowed_origins = [
    origin.strip().rstrip('/')
    for origin in os.environ.get(
        'STM32_ALLOWED_ORIGINS',
        'http://127.0.0.1:8013,http://localhost:8013,http://127.0.0.1:8014,http://localhost:8014',
    ).split(',')
    if origin.strip()
]
CORS(app, origins=allowed_origins)
sock = Sock(app)

NUM = r'[-+]?\d+(?:\.\d+)?'
ACC_PATTERN = re.compile(rf'^ACC:\s*{NUM}\s+{NUM}\s+{NUM}\s+g$')
GYRO_PATTERN = re.compile(rf'^GYRO:\s*{NUM}\s+{NUM}\s+{NUM}\s+deg/s$')
ANGLE_PATTERN = re.compile(rf'^ANGLE:\s*{NUM}\s+{NUM}\s+{NUM}\s+deg$')
IMU_PATTERN = re.compile(
    rf'^ACC:\s*{NUM}\s+{NUM}\s+{NUM}\s+g\s+'
    rf'ANGLE:\s+{NUM}\s+{NUM}\s+{NUM}\s+deg\s+'
    rf'GYRO:\s+{NUM}\s+{NUM}\s+{NUM}\s+deg/s$'
)
NMEA_PATTERN = re.compile(r'^\$[A-Z]{2}GGA,')
ALARM_PATTERN = re.compile(r'^ALARM:\s+level=\w+\s+score=[\d.]+')
ALARM_VALUES_PATTERN = re.compile(
    rf'^ALARM:\s+level=(?P<level>\w+)\s+'
    rf'score=(?P<score>{NUM})\s+'
    rf'D=(?P<D>{NUM})mm\s+'
    rf'V=(?P<V>{NUM})mm/min\s+'
    rf'E=(?P<E>{NUM})mm\s+'
    rf'N=(?P<N>{NUM})mm\s+'
    rf'U=(?P<U>{NUM})mm\s+'
    rf'tilt=(?P<tilt>{NUM})deg\s+'
    rf'accDyn=(?P<accDyn>{NUM})g\s+'
    rf'q=(?P<q>\d+)\s+'
    rf'sats=(?P<sats>\d+)$'
)
ENVIRONMENT_PATTERN = re.compile(
    rf'^TEMP(?:ERATURE)?:\s*(?P<temperature>{NUM})\s*(?:°?C|℃)?\s*'
    rf'(?:[,;]\s*|\s+)HUM(?:I|IDITY)?:\s*(?P<humidity>{NUM})\s*'
    rf'(?:%RH|RH|%)?$',
    re.IGNORECASE,
)
DEVICE_ID_PATTERN = re.compile(r'^\d+$')
DEVICE_MESSAGE_PATTERN = re.compile(r'^(\d+),(.*)$')
DEVICE_ID_PREFIX_MESSAGE_PATTERN = re.compile(r'^device_id=(\d+):\s*(.*)$', re.IGNORECASE)
DEVICE_OFFLINE_MS = 5000
QUALITY_NAMES = {
    "0": "未定位",
    "1": "单点定位",
    "2": "差分定位",
    "4": "RTK 固定解",
    "5": "RTK 浮点解",
}
ACC_VALUES_PATTERN = re.compile(rf'ACC:\s*({NUM})\s+({NUM})\s+({NUM})\s+g')
GYRO_VALUES_PATTERN = re.compile(rf'GYRO:\s*({NUM})\s+({NUM})\s+({NUM})\s+deg/s')
ANGLE_VALUES_PATTERN = re.compile(rf'ANGLE:\s*({NUM})\s+({NUM})\s+({NUM})\s+deg')

ALARM_SETTING_KEYS = ('acc_x', 'acc_y', 'angle_x', 'angle_y', 'angle_z')
DEFAULT_ALARM_SETTINGS = {key: None for key in ALARM_SETTING_KEYS}
_alarm_settings_path = os.environ.get('STM32_ALARM_SETTINGS_PATH', '').strip()
ALARM_SETTINGS_PATH = Path(_alarm_settings_path) if _alarm_settings_path else Path(__file__).with_name('alarm_settings.json')
ALARM_METRICS = (
    ('acc_x', '加速度 X', 'acc', 0, 'g'),
    ('acc_y', '加速度 Y', 'acc', 1, 'g'),
    ('angle_x', '姿态角 X', 'angle', 0, '°'),
    ('angle_y', '姿态角 Y', 'angle', 1, '°'),
    ('angle_z', '姿态角 Z', 'angle', 2, '°'),
)


def normalize_alarm_settings(payload):
    if not isinstance(payload, dict):
        raise ValueError('settings must be an object')

    normalized = {}
    for key in ALARM_SETTING_KEYS:
        value = payload.get(key)
        if value is None:
            normalized[key] = None
            continue
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError(f'{key} must be a non-negative number or null')
        if not math.isfinite(value) or value < 0:
            raise ValueError(f'{key} must be a non-negative number or null')
        normalized[key] = float(value)
    return normalized


def load_alarm_settings(path=ALARM_SETTINGS_PATH):
    try:
        with Path(path).open('r', encoding='utf-8') as settings_file:
            return normalize_alarm_settings(json.load(settings_file))
    except (OSError, ValueError, json.JSONDecodeError):
        return copy.deepcopy(DEFAULT_ALARM_SETTINGS)


def save_alarm_settings(settings, path=ALARM_SETTINGS_PATH):
    normalized = normalize_alarm_settings(settings)
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(f'.{target.name}.{os.getpid()}.{threading.get_ident()}.tmp')
    try:
        with temporary.open('w', encoding='utf-8') as settings_file:
            json.dump(normalized, settings_file, ensure_ascii=False, indent=2)
            settings_file.write('\n')
        os.replace(temporary, target)
    finally:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass
    return normalized


alarm_settings_lock = threading.RLock()
alarm_settings = load_alarm_settings()
alarm_settings_updated_at_ms = 0
alarm_settings_revision = 0


def evaluate_cloud_alarm(state, now_ms=None):
    if now_ms is None:
        now_ms = int(time.time() * 1000)
    now_ms = int(now_ms)
    last_seen_ms = int(state.get('last_seen_ms') or 0)
    if last_seen_ms <= 0 or now_ms - last_seen_ms >= DEVICE_OFFLINE_MS:
        return None

    with alarm_settings_lock:
        settings = copy.deepcopy(alarm_settings)

    imu = state.get('imu') or {}
    imu_valid = state.get('imu_valid') or {}
    conditions = []
    for key, label, vector_name, index, unit in ALARM_METRICS:
        threshold = settings.get(key)
        vector = imu.get(vector_name) or []
        if threshold is None or not imu_valid.get(vector_name, False) or len(vector) <= index:
            continue
        value = vector[index]
        if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value):
            continue
        absolute_value = abs(value)
        if absolute_value < threshold:
            continue
        conditions.append({
            'metric': key,
            'label': label,
            'value': float(value),
            'absolute_value': float(absolute_value),
            'threshold': float(threshold),
            'unit': unit,
        })

    if not conditions:
        return None

    first = conditions[0]
    return {
        'level': 'RED',
        'source': 'cloud',
        'metric': first['metric'],
        'label': first['label'],
        'value': first['value'],
        'absolute_value': first['absolute_value'],
        'threshold': first['threshold'],
        'unit': first['unit'],
        'conditions': conditions,
        'message': (
            f"{first['label']} 达到 {first['absolute_value']:.3f}{first['unit']}，"
            f"阈值 {first['threshold']:.3f}{first['unit']}"
        ),
        'triggered_at_ms': now_ms,
    }


def is_device_id_line(raw_text):
    text = str(raw_text or '').strip()
    return bool(text and DEVICE_ID_PATTERN.fullmatch(text))


def parse_imu_update(raw_text):
    text = str(raw_text or '').strip()
    patterns = (
        ("acc", ACC_VALUES_PATTERN),
        ("gyro", GYRO_VALUES_PATTERN),
        ("angle", ANGLE_VALUES_PATTERN),
    )
    updates = {}
    for key, pattern in patterns:
        match = pattern.search(text)
        if match:
            updates[key] = [
                float(match.group(1)),
                float(match.group(2)),
                float(match.group(3)),
            ]
    return updates


def is_valid_message(raw_text):
    text = str(raw_text or '').strip()
    if not text or len(text) > 500:
        return False
    return bool(
        ACC_PATTERN.fullmatch(text)
        or GYRO_PATTERN.fullmatch(text)
        or ANGLE_PATTERN.fullmatch(text)
        or IMU_PATTERN.fullmatch(text)
        or NMEA_PATTERN.match(text)
        or ALARM_PATTERN.match(text)
        or ENVIRONMENT_PATTERN.fullmatch(text)
    )


def parse_device_message(raw_text, bound_device_id=None):
    text = str(raw_text or '').strip()
    match = DEVICE_MESSAGE_PATTERN.fullmatch(text) or DEVICE_ID_PREFIX_MESSAGE_PATTERN.fullmatch(text)
    if match:
        device_id, payload = match.groups()
        payload = payload.strip()
        if not payload or not is_valid_message(payload):
            return None
        return device_id, payload, text

    if bound_device_id is not None and is_valid_message(text):
        return str(bound_device_id), text, text
    return None


def _parse_nmea_coordinate(value, direction, degree_digits):
    value = str(value or '').strip()
    direction = str(direction or '').strip().upper()
    if not value or direction not in {'N', 'S', 'E', 'W'}:
        return None

    try:
        degrees = float(value[:degree_digits])
        minutes = float(value[degree_digits:])
    except (TypeError, ValueError):
        return None

    if not math.isfinite(degrees) or not math.isfinite(minutes):
        return None
    if minutes < 0 or minutes >= 60:
        return None
    if degree_digits == 2 and (degrees < 0 or degrees > 90):
        return None
    if degree_digits == 3 and (degrees < 0 or degrees > 180):
        return None

    coordinate = degrees + minutes / 60.0
    if direction in {'S', 'W'}:
        coordinate = -coordinate
    return coordinate


def parse_gngga_update(payload):
    text = str(payload or '').strip()
    if not NMEA_PATTERN.match(text):
        return None

    fields = text.split(',')
    if len(fields) <= 9:
        return None

    quality_code = fields[6].strip() or '0'
    try:
        satellites = int(fields[7]) if fields[7].strip() else 0
    except ValueError:
        satellites = 0

    try:
        altitude = float(fields[9]) if fields[9].strip() else None
    except ValueError:
        altitude = None

    return {
        'latitude': _parse_nmea_coordinate(fields[2], fields[3], 2),
        'longitude': _parse_nmea_coordinate(fields[4], fields[5], 3),
        'altitude': altitude,
        'quality_code': quality_code,
        'quality': QUALITY_NAMES.get(quality_code, '未知定位'),
        'satellites': satellites,
    }


def parse_alarm_update(payload):
    match = ALARM_VALUES_PATTERN.fullmatch(str(payload or '').strip())
    if not match:
        return None

    values = match.groupdict()
    return {
        'level': values['level'],
        'score': float(values['score']),
        'D': float(values['D']),
        'V': float(values['V']),
        'E': float(values['E']),
        'N': float(values['N']),
        'U': float(values['U']),
        'tilt': float(values['tilt']),
        'accDyn': float(values['accDyn']),
        'q': int(values['q']),
        'sats': int(values['sats']),
    }


def parse_environment_update(payload):
    match = ENVIRONMENT_PATTERN.fullmatch(str(payload or '').strip())
    if not match:
        return None

    values = match.groupdict()
    return {
        'temperature': float(values['temperature']),
        'humidity': float(values['humidity']),
    }


default_imu = {"acc": [0, 0, 0], "gyro": [0, 0, 0], "angle": [0, 0, 0]}
default_imu_valid = {"acc": False, "gyro": False, "angle": False}


def create_device_state(device_id):
    return {
        'device_id': str(device_id),
        'online': False,
        'message_seq': 0,
        'messages': [],
        'imu': copy.deepcopy(default_imu),
        'imu_valid': copy.deepcopy(default_imu_valid),
        'longitude': None,
        'latitude': None,
        'altitude': None,
        'quality_code': '0',
        'quality': '等待数据',
        'satellites': 0,
        'temperature': None,
        'humidity': None,
        'rtk_status': '等待数据',
        'message': 'no data',
        'last_message': '',
        'raw': '',
        'alarm': None,
        'server_timestamp': 0,
        'last_seen_ms': 0,
    }


devices = {}
active_clients = []
device_clients = {}
client_device_ids = {}
retired_clients = set()
clients_lock = threading.RLock()
ws_clients = set()
ws_lock = threading.Lock()


def apply_device_message(device_id, payload, raw_line=None, now_ms=None, source_client=None):
    device_id = str(device_id or '').strip()
    payload = str(payload or '').strip()
    if not is_device_id_line(device_id) or not is_valid_message(payload):
        return None

    if now_ms is None:
        now_ms = int(time.time() * 1000)
    now_ms = int(now_ms)
    raw_line = str(raw_line if raw_line is not None else f'{device_id},{payload}')

    with clients_lock:
        if source_client is not None and (
            source_client in retired_clients
            or device_clients.get(device_id) is not source_client
        ):
            return None

        state = devices.setdefault(device_id, create_device_state(device_id))
        state['online'] = True
        state['message'] = payload
        state['last_message'] = payload
        state['raw'] = raw_line
        state['server_timestamp'] = now_ms
        state['last_seen_ms'] = now_ms
        state['message_seq'] += 1
        state['messages'].append({
            'seq': state['message_seq'],
            'message': payload,
            'raw': raw_line,
            'device_id': device_id,
            'server_timestamp': now_ms,
        })
        state['messages'] = state['messages'][-100:]

        imu_update = parse_imu_update(payload)
        if imu_update:
            state['imu'].update(imu_update)
            for vector_name in imu_update:
                state['imu_valid'][vector_name] = True

        gngga_update = parse_gngga_update(payload)
        if gngga_update:
            for key in ('latitude', 'longitude', 'altitude'):
                if gngga_update[key] is not None:
                    state[key] = gngga_update[key]
            state['quality_code'] = gngga_update['quality_code']
            state['quality'] = gngga_update['quality']
            state['rtk_status'] = gngga_update['quality']
            state['satellites'] = gngga_update['satellites']

        if NMEA_PATTERN.match(payload):
            try:
                state['gnss'] = gnss_service.update(device_id, payload, now_ms)
            except ValueError:
                state['gnss'] = {'algorithm': 'robust-adaptive-position-kf-v1',
                                 'status': 'checkpoint_error', 'valid': False,
                                 'history': [], 'persistence_error': True}

        environment_update = parse_environment_update(payload)
        if environment_update is not None:
            state['temperature'] = environment_update['temperature']
            state['humidity'] = environment_update['humidity']

        state['alarm'] = evaluate_cloud_alarm(state, now_ms)

        return copy.deepcopy(state)


def build_data_snapshot(now_ms=None):
    if now_ms is None:
        now_ms = int(time.time() * 1000)
    now_ms = int(now_ms)

    with clients_lock:
        snapshot_devices = copy.deepcopy(devices)

    for device_id, state in snapshot_devices.items():
        last_seen_ms = int(state.get('last_seen_ms') or 0)
        age_ms = now_ms - last_seen_ms if last_seen_ms > 0 else -1
        state['data_age_ms'] = age_ms
        state['online'] = 0 <= age_ms < DEVICE_OFFLINE_MS
        gnss_snapshot = gnss_service.snapshot(device_id, now_ms)
        if gnss_snapshot is not None:
            state['gnss'] = gnss_snapshot
        state['alarm'] = evaluate_cloud_alarm(state, now_ms)
        snapshot_devices[device_id] = state

    with alarm_settings_lock:
        snapshot_alarm_settings = copy.deepcopy(alarm_settings)
        snapshot_alarm_settings_updated_at_ms = alarm_settings_updated_at_ms
        snapshot_alarm_settings_revision = alarm_settings_revision

    return {
        'devices': snapshot_devices,
        'server_timestamp': now_ms,
        'alarm_settings': snapshot_alarm_settings,
        'alarm_settings_updated_at_ms': snapshot_alarm_settings_updated_at_ms,
        'alarm_settings_revision': snapshot_alarm_settings_revision,
    }


@sock.route('/ws')
def handle_ws(ws):
    client_ip = request.remote_addr
    print(f"WS client connected: {client_ip}")

    with ws_lock:
        ws_clients.add(ws)

    try:
        ws.send(json.dumps(build_data_snapshot(), ensure_ascii=False))
    except Exception as e:
        print(f"Initial WS send failed: {e}")

    try:
        while True:
            data = ws.receive()
            if data is None:
                break
    except Exception as e:
        print(f"WS connection error ({client_ip}): {e}")
    finally:
        with ws_lock:
            if ws in ws_clients:
                ws_clients.remove(ws)
        print(f"WS client disconnected: {client_ip}")


def push_to_mini_program():
    data_str = json.dumps(build_data_snapshot(), ensure_ascii=False)
    dead_ws = []

    with ws_lock:
        for ws in ws_clients:
            try:
                ws.send(data_str)
            except Exception:
                dead_ws.append(ws)

        for dead in dead_ws:
            if dead in ws_clients:
                ws_clients.remove(dead)


@app.route('/data', methods=['GET'])
def get_data():
    return jsonify(build_data_snapshot())


def _alarm_settings_response():
    with alarm_settings_lock:
        return {
            'settings': copy.deepcopy(alarm_settings),
            'updated_at_ms': alarm_settings_updated_at_ms,
            'revision': alarm_settings_revision,
        }


@app.route('/alarm-settings', methods=['GET'])
def get_alarm_settings():
    return jsonify(_alarm_settings_response())


@app.route('/alarm-settings', methods=['PUT'])
def update_alarm_settings():
    global alarm_settings, alarm_settings_updated_at_ms, alarm_settings_revision

    try:
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            raise ValueError('请求必须包含 JSON 对象')
        next_settings = normalize_alarm_settings(payload)
        now_ms = int(time.time() * 1000)
        with alarm_settings_lock:
            save_alarm_settings(next_settings, ALARM_SETTINGS_PATH)
            alarm_settings = copy.deepcopy(next_settings)
            alarm_settings_updated_at_ms = now_ms
            alarm_settings_revision += 1
    except ValueError as exc:
        return jsonify({'status': 'error', 'settings': _alarm_settings_response()['settings'], 'msg': str(exc)}), 400
    except OSError as exc:
        return jsonify({'status': 'error', 'settings': _alarm_settings_response()['settings'], 'msg': f'保存失败: {exc}'}), 500

    with clients_lock:
        for state in devices.values():
            state['alarm'] = evaluate_cloud_alarm(state, now_ms)

    push_to_mini_program()
    return jsonify(_alarm_settings_response())


def _close_client(client):
    try:
        client.shutdown(socket.SHUT_RDWR)
    except (AttributeError, OSError):
        pass
    try:
        client.close()
    except Exception:
        pass


def bind_device_client(client, device_id):
    device_id = str(device_id or '').strip()
    if not is_device_id_line(device_id):
        return False

    old_client = None
    with clients_lock:
        if client in retired_clients:
            return False

        if client not in active_clients:
            active_clients.append(client)

        old_device_id = client_device_ids.get(client)
        if old_device_id and old_device_id != device_id:
            if device_clients.get(old_device_id) is client:
                device_clients.pop(old_device_id, None)

        old_client = device_clients.get(device_id)
        if old_client is not None and old_client is not client:
            retired_clients.add(old_client)
            if client_device_ids.get(old_client) == device_id:
                client_device_ids.pop(old_client, None)
            if old_client in active_clients:
                active_clients.remove(old_client)

        device_clients[device_id] = client
        client_device_ids[client] = device_id

    if old_client is not None and old_client is not client:
        _close_client(old_client)
    return True


def remove_device_client(client):
    with clients_lock:
        if client in active_clients:
            active_clients.remove(client)

        device_id = client_device_ids.pop(client, None)
        if device_id is not None and device_clients.get(device_id) is client:
            device_clients.pop(device_id, None)
        retired_clients.discard(client)


@app.route('/send_cmd', methods=['GET'])
def send_command():
    requested_device_id = request.args.get('device_id')
    if requested_device_id is None or not is_device_id_line(requested_device_id):
        return jsonify({
            "status": "error",
            "msg": "device_id must be a numeric device ID",
        }), 400

    device_id = str(requested_device_id).strip()
    command = request.args.get('cmd', 'ping')
    now_ms = int(time.time() * 1000)

    with clients_lock:
        state = devices.get(device_id)
        client = device_clients.get(device_id)
        last_seen_ms = int(state.get('last_seen_ms') or 0) if state else 0
        age_ms = now_ms - last_seen_ms if last_seen_ms > 0 else -1
        if state is None or client is None or not (0 <= age_ms < DEVICE_OFFLINE_MS):
            return jsonify({
                "status": "error",
                "msg": f"Device {device_id} is offline or unavailable",
            }), 409

        send_str = f"{command}\r\n".encode('utf-8')
        try:
            client.send(send_str)
        except Exception:
            if device_clients.get(device_id) is client:
                device_clients.pop(device_id, None)
            if client_device_ids.get(client) == device_id:
                client_device_ids.pop(client, None)
            if client in active_clients:
                active_clients.remove(client)
            _close_client(client)
            return jsonify({
                "status": "error",
                "msg": f"Send failed for device {device_id}",
            }), 409

    return jsonify({
        "status": "success",
        "device_id": device_id,
        "msg": f"Command [{command}] sent to device {device_id}",
    })


def handle_client(client, addr):
    print(f"4G device connected: {addr}")
    with clients_lock:
        if client not in active_clients:
            active_clients.append(client)

    buffer = ""
    pending_device_id = None

    try:
        while True:
            data = client.recv(1024)
            if not data:
                break

            buffer += data.decode('utf-8', errors='ignore')

            while '\n' in buffer:
                line, buffer = buffer.split('\n', 1)
                line = line.strip()
                if not line:
                    continue

                if is_device_id_line(line):
                    pending_device_id = line
                    if not bind_device_client(client, pending_device_id):
                        return
                    print(f"ID [{addr}]: device_id={pending_device_id}")
                    continue

                parsed = parse_device_message(line, pending_device_id)
                if parsed is None:
                    if len(line) <= 80:
                        print(f"RESP [{addr}]: {line}")
                    else:
                        print(f"DROP [{addr}]: {line[:80]}...")
                    continue

                device_id, payload, raw_line = parsed
                pending_device_id = device_id
                if not bind_device_client(client, device_id):
                    return
                updated_state = apply_device_message(
                    device_id,
                    payload,
                    raw_line=raw_line,
                    source_client=client,
                )
                if updated_state is None:
                    print(f"DROP [{addr}] device_id={device_id}: {payload[:80]}")
                    return

                print(f"DATA [{addr}] device_id={device_id}: {payload}")
                push_to_mini_program()
    except Exception as e:
        print(f"4G device error {addr}: {e}")
    finally:
        print(f"4G device disconnected: {addr}")
        remove_device_client(client)
        _close_client(client)


def tcp_server(port=DEVICE_TCP_PORT):
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_KEEPALIVE, 1)
    server.bind(('0.0.0.0', port))
    server.listen(10)
    print(f"4G TCP server started on port {port}")

    while True:
        try:
            client, addr = server.accept()
            threading.Thread(target=handle_client, args=(client, addr), daemon=True).start()
        except Exception as e:
            print(f"TCP server error: {e}")


def main():
    threading.Thread(target=tcp_server, daemon=True).start()

    print(f"HTTP / WebSocket server starting on port {HTTP_PORT}")
    print(f"HTTP endpoint: http://127.0.0.1:{HTTP_PORT}/data")
    print(f"WebSocket endpoint: ws://127.0.0.1:{HTTP_PORT}/ws")

    import eventlet.wsgi
    eventlet.wsgi.server(eventlet.listen(('0.0.0.0', HTTP_PORT)), app)


if __name__ == '__main__':
    main()

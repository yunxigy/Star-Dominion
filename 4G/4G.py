# -*- coding: utf-8 -*-
import eventlet
eventlet.monkey_patch()

import json
import os
import re
import socket
import threading
import time

from flask import Flask, jsonify, request
from flask_cors import CORS
from flask_sock import Sock


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
NMEA_PATTERN = re.compile(r'^\$GNGGA,')
ALARM_PATTERN = re.compile(r'^ALARM:\s+level=\w+\s+score=[\d.]+')
DEVICE_ID_PATTERN = re.compile(r'^\d$')
ACC_VALUES_PATTERN = re.compile(rf'^ACC:\s*({NUM})\s+({NUM})\s+({NUM})\s+g$')
GYRO_VALUES_PATTERN = re.compile(rf'^GYRO:\s*({NUM})\s+({NUM})\s+({NUM})\s+deg/s$')
ANGLE_VALUES_PATTERN = re.compile(rf'^ANGLE:\s*({NUM})\s+({NUM})\s+({NUM})\s+deg$')


def is_device_id_line(raw_text):
    return bool(raw_text and DEVICE_ID_PATTERN.match(raw_text))


def parse_imu_update(raw_text):
    patterns = (
        ("acc", ACC_VALUES_PATTERN),
        ("gyro", GYRO_VALUES_PATTERN),
        ("angle", ANGLE_VALUES_PATTERN),
    )
    for key, pattern in patterns:
        match = pattern.match(raw_text)
        if match:
            return {key: [float(match.group(1)), float(match.group(2)), float(match.group(3))]}
    return {}


def is_valid_message(raw_text):
    if not raw_text or len(raw_text) > 500:
        return False
    return bool(
        ACC_PATTERN.match(raw_text)
        or GYRO_PATTERN.match(raw_text)
        or ANGLE_PATTERN.match(raw_text)
        or IMU_PATTERN.match(raw_text)
        or NMEA_PATTERN.match(raw_text)
        or ALARM_PATTERN.match(raw_text)
    )


latest_data = {
    "device_id": None,
    "message_seq": 0,
    "messages": [],
    "imu": {"acc": [0, 0, 0], "gyro": [0, 0, 0], "angle": [0, 0, 0]},
    "longitude": 0.0,
    "latitude": 0.0,
    "rtk_status": "waiting for device...",
    "message": "no data",
    "server_timestamp": 0,
}

active_clients = []
clients_lock = threading.Lock()
ws_clients = set()
ws_lock = threading.Lock()


@sock.route('/ws')
def handle_ws(ws):
    client_ip = request.remote_addr
    print(f"WS client connected: {client_ip}")

    with ws_lock:
        ws_clients.add(ws)

    try:
        ws.send(json.dumps(latest_data))
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
    data_str = json.dumps(latest_data)
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
    age_ms = int(time.time() * 1000) - latest_data["server_timestamp"] if latest_data["server_timestamp"] > 0 else -1
    return jsonify({**latest_data, "data_age_ms": age_ms})


@app.route('/send_cmd', methods=['GET'])
def send_command():
    command = request.args.get('cmd', 'ping')
    with clients_lock:
        if not active_clients:
            return jsonify({"status": "error", "msg": "No 4G device online"})

        send_str = f"{command}\r\n".encode('utf-8')
        success_count = 0
        dead_clients = []

        for client in active_clients:
            try:
                client.send(send_str)
                success_count += 1
            except Exception:
                dead_clients.append(client)

        for dead_client in dead_clients:
            if dead_client in active_clients:
                active_clients.remove(dead_client)
            try:
                dead_client.close()
            except Exception:
                pass

    if success_count > 0:
        return jsonify({"status": "success", "msg": f"Command [{command}] sent to {success_count} device(s)"})
    return jsonify({"status": "error", "msg": "Send failed; all devices disconnected"})


def handle_client(client, addr):
    global latest_data
    print(f"4G device connected: {addr}")
    with clients_lock:
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
                    print(f"ID [{addr}]: device_id={pending_device_id}")
                    continue

                if not is_valid_message(line):
                    if len(line) <= 80:
                        print(f"RESP [{addr}]: {line}")
                    else:
                        print(f"DROP [{addr}]: {line[:80]}...")
                    continue

                if pending_device_id is not None:
                    latest_data["device_id"] = pending_device_id
                    pending_device_id = None

                now_ms = int(time.time() * 1000)
                latest_data["message"] = line
                imu_update = parse_imu_update(line)
                if imu_update:
                    latest_data.setdefault(
                        "imu",
                        {"acc": [0, 0, 0], "gyro": [0, 0, 0], "angle": [0, 0, 0]},
                    ).update(imu_update)
                latest_data["server_timestamp"] = now_ms
                latest_data["message_seq"] = latest_data.get("message_seq", 0) + 1
                latest_data.setdefault("messages", []).append({
                    "seq": latest_data["message_seq"],
                    "message": line,
                    "device_id": latest_data.get("device_id"),
                    "server_timestamp": now_ms,
                })
                latest_data["messages"] = latest_data["messages"][-100:]
                print(f"DATA [{addr}] device_id={latest_data.get('device_id')}: {line}")

                push_to_mini_program()

                with clients_lock:
                    dead_clients = []
                    for other_client in active_clients:
                        if other_client != client:
                            try:
                                other_client.send((line + '\r\n').encode('utf-8'))
                            except Exception:
                                dead_clients.append(other_client)
                    for dead_client in dead_clients:
                        if dead_client in active_clients:
                            active_clients.remove(dead_client)
    except Exception as e:
        print(f"4G device error {addr}: {e}")
    finally:
        print(f"4G device disconnected: {addr}")
        with clients_lock:
            if client in active_clients:
                active_clients.remove(client)
        try:
            client.close()
        except Exception:
            pass


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

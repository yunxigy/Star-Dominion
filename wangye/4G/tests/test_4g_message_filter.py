import importlib.util
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch


class FakeClient:
    def __init__(self):
        self.sent = []
        self.closed = False

    def send(self, data):
        self.sent.append(data)

    def shutdown(self, *_args):
        self.closed = True

    def close(self):
        self.closed = True


class FakeStreamClient(FakeClient):
    def __init__(self, chunks):
        super().__init__()
        self.chunks = list(chunks)

    def recv(self, _size):
        if self.chunks:
            return self.chunks.pop(0)
        return b""


def load_4g_module():
    root = Path(__file__).resolve().parents[1]

    eventlet = types.ModuleType("eventlet")
    eventlet.monkey_patch = lambda: None
    sys.modules["eventlet"] = eventlet

    flask = types.ModuleType("flask")
    flask.Flask = lambda *args, **kwargs: types.SimpleNamespace(route=lambda *a, **k: (lambda f: f))
    def jsonify_stub(*args, **kwargs):
        if len(args) == 1 and not kwargs:
            return args[0]
        return kwargs or {"args": args}

    flask.jsonify = jsonify_stub
    flask.request = types.SimpleNamespace(args={}, remote_addr="127.0.0.1")
    sys.modules["flask"] = flask

    flask_cors = types.ModuleType("flask_cors")
    flask_cors.CORS = lambda *args, **kwargs: None
    sys.modules["flask_cors"] = flask_cors

    flask_sock = types.ModuleType("flask_sock")
    flask_sock.Sock = lambda *args, **kwargs: types.SimpleNamespace(route=lambda *a, **k: (lambda f: f))
    sys.modules["flask_sock"] = flask_sock

    spec = importlib.util.spec_from_file_location("four_g", root / "4G.py")
    module = importlib.util.module_from_spec(spec)
    sys.path.insert(0, str(root))
    try:
        spec.loader.exec_module(module)
    finally:
        sys.path.remove(str(root))
    return module


class MessageFilterTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.module = load_4g_module()

    def setUp(self):
        self.gnss_directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.gnss_directory.cleanup)
        self.module.gnss_service = self.module.GnssService(self.gnss_directory.name)
        for name in ("devices", "device_clients", "client_device_ids", "retired_clients"):
            collection = getattr(self.module, name, None)
            if hasattr(collection, "clear"):
                collection.clear()
        for name in ("active_clients", "ws_clients"):
            collection = getattr(self.module, name, None)
            if hasattr(collection, "clear"):
                collection.clear()
        self.module.alarm_settings = {
            key: None for key in self.module.ALARM_SETTING_KEYS
        }
        self.module.alarm_settings_updated_at_ms = 0
        self.module.alarm_settings_revision = 0

    @staticmethod
    def _response_parts(result):
        if isinstance(result, tuple):
            return result[0], result[1]
        return result, 200

    def _now_ms(self):
        return int(self.module.time.time() * 1000)

    def test_snapshot_publishes_server_enu_once_and_expires_without_new_gnss(self):
        from test_gnss_filter import gga
        for k in range(20):
            self.module.apply_device_message('1', gga(30000+4*k), now_ms=100000+4000*k)
        snapshot = self.module.build_data_snapshot(now_ms=176000)['devices']['1']['gnss']
        self.assertEqual(snapshot['sequence'], 20)
        self.assertEqual(snapshot['status'], 'measured')
        self.assertEqual(len(snapshot['history']), 20)
        self.module.apply_device_message('1', gga(30076), now_ms=180000)
        self.assertEqual(self.module.build_data_snapshot(now_ms=180000)['devices']['1']['gnss']['sequence'], 20)
        self.module.apply_device_message('1', 'TEMP: 26.7 C, HUMI: 41.6 %', now_ms=190000)
        expired = self.module.build_data_snapshot(now_ms=190000)['devices']['1']
        self.assertTrue(expired['online'])
        self.assertEqual(expired['gnss']['status'], 'expired')
        self.assertIsNone(expired['gnss']['filtered_enu_mm'])

    def test_accepts_split_imu_lines_from_device(self):
        valid_lines = [
            "ACC: 0.214 0.068 -0.979 g",
            "GYRO: 0.012 -0.003 0.018 deg/s",
            "ANGLE: -3.126 -14.485 178.127 deg",
        ]

        for line in valid_lines:
            with self.subTest(line=line):
                self.assertTrue(self.module.is_valid_message(line))

    def test_accepts_existing_gps_alarm_and_combined_imu_formats(self):
        valid_lines = [
            "ACC: -0.020 -0.001 -1.005 g ANGLE: 1.088 -0.961 169.376 deg GYRO: 0.244 0.000 0.000 deg/s",
            "$GNGGA,094555.00,3648.62575231,N,11759.60830819,E,4,26,0.7,35.3192,M,-3.7117,M,63.0,0*7A",
            "ALARM: level=YELLOW score=20.0 D=0.00mm V=0.00mm/min E=0.00mm N=0.00mm U=0.00mm tilt=14.82deg accDyn=0.004g q=4 sats=26",
        ]

        for line in valid_lines:
            with self.subTest(line=line):
                self.assertTrue(self.module.is_valid_message(line))

    def test_accepts_gb_gga_messages_from_the_device(self):
        payload = "$GBGGA,121520.00,3648.62646082,N,11759.61107990,E,7,09,1.5,33.4547,M"
        self.assertTrue(self.module.is_valid_message(payload))
        result = self.module.parse_gngga_update(payload)
        self.assertEqual(result["quality_code"], "7")
        self.assertEqual(result["satellites"], 9)
        self.assertAlmostEqual(result["altitude"], 33.4547)

    def test_rejects_ack_and_error_responses(self):
        invalid_lines = ["1", "ERR: command not found.", "GET / HTTP/1.1"]

        for line in invalid_lines:
            with self.subTest(line=line):
                self.assertFalse(self.module.is_valid_message(line))

    def test_recognizes_one_or_more_digit_device_id_lines(self):
        for line in ["0", "1", "9", "10", "105"]:
            with self.subTest(line=line):
                self.assertTrue(self.module.is_device_id_line(line))

        for line in ["A1", "12,$GNGGA,...", "ERR: 1 not found."]:
            with self.subTest(line=line):
                self.assertFalse(self.module.is_device_id_line(line))

    def test_splits_prefixed_message_at_the_first_comma_only(self):
        payload = "$GNGGA,094555.00,3648.62575231,N,11759.60830819,E,4,26,0.7,35.3192,M"
        raw = "12," + payload
        self.assertEqual(
            self.module.parse_device_message(raw),
            ("12", payload, raw),
        )

    def test_splits_stm32_device_id_colon_prefix(self):
        payload = "$GNGGA,,,,,,0,,,,,,,,*78"
        raw = "device_id=2:" + payload
        self.assertEqual(
            self.module.parse_device_message(raw),
            ("2", payload, raw),
        )

    def test_accepts_legacy_payload_for_a_bound_connection(self):
        payload = "$GNGGA,094555.00,3648.62575231,N,11759.60830819,E,4,26,0.7,35.3192,M"
        self.assertEqual(
            self.module.parse_device_message(payload, bound_device_id="12"),
            ("12", payload, payload),
        )

    def test_handle_client_registers_colon_prefixed_device_two_messages(self):
        payloads = [
            "$GBGGA,,,,,,0,,,,,,,,*78",
            "ANGLE: 0.467 0.236 -123.201 deg",
            "GYRO: 0.183 0.000 0.061 deg/s",
            "ACC: -0.002 0.007 0.997 g",
            "TEMP: 26.7 C, HUMI: 41.6 %",
        ]
        source = FakeStreamClient(
            [(f"device_id=2:{payload}\n").encode("utf-8") for payload in payloads] + [b""]
        )

        with patch.object(self.module, "push_to_mini_program"):
            self.module.handle_client(source, ("device-2", 8008))

        state = self.module.devices["2"]
        self.assertEqual(state["message_seq"], len(payloads))
        self.assertEqual(state["imu"]["angle"], [0.467, 0.236, -123.201])
        self.assertEqual(state["imu"]["gyro"], [0.183, 0.0, 0.061])
        self.assertEqual(state["imu"]["acc"], [-0.002, 0.007, 0.997])
        self.assertEqual(state["temperature"], 26.7)
        self.assertEqual(state["humidity"], 41.6)

    def test_device_alarm_message_is_not_used_for_cloud_alarm(self):
        payload = "ALARM: level=YELLOW score=20.0 D=0.00mm V=0.00mm/min E=0.00mm N=0.00mm U=0.00mm tilt=14.82deg accDyn=0.004g q=4 sats=26"
        self.module.apply_device_message("2", payload, "2," + payload, now_ms=1000)
        snapshot = self.module.build_data_snapshot(now_ms=1000)
        self.assertIsNone(snapshot["devices"]["2"]["alarm"])

    def test_normalize_alarm_settings_defaults_to_disabled(self):
        self.assertEqual(
            self.module.normalize_alarm_settings({}),
            {
                "acc_x": None,
                "acc_y": None,
                "angle_x": None,
                "angle_y": None,
                "angle_z": None,
            },
        )

    def test_normalize_alarm_settings_accepts_finite_non_negative_values(self):
        result = self.module.normalize_alarm_settings({
            "acc_x": 0.8,
            "acc_y": None,
            "angle_x": 15,
            "angle_y": 30.5,
            "angle_z": 90,
        })
        self.assertEqual(result["acc_x"], 0.8)
        self.assertEqual(result["angle_y"], 30.5)

    def test_normalize_alarm_settings_rejects_invalid_values(self):
        for payload in (
            {"acc_x": -0.1},
            {"angle_x": "30"},
            {"angle_y": float("inf")},
            {"angle_z": True},
        ):
            with self.subTest(payload=payload):
                with self.assertRaises(ValueError):
                    self.module.normalize_alarm_settings(payload)

    def test_cloud_alarm_uses_absolute_value_and_or_logic(self):
        self.module.alarm_settings = {
            "acc_x": 0.8,
            "acc_y": 0.8,
            "angle_x": None,
            "angle_y": 30.0,
            "angle_z": None,
        }
        state = self.module.create_device_state("2")
        state["last_seen_ms"] = 1000
        state["imu"]["acc"] = [-0.85, 0.1, 0.0]
        state["imu"]["angle"] = [0.0, -31.0, 0.0]
        state["imu_valid"]["acc"] = True
        state["imu_valid"]["angle"] = True

        alarm = self.module.evaluate_cloud_alarm(state, now_ms=1000)

        self.assertEqual(alarm["source"], "cloud")
        self.assertEqual(alarm["metric"], "acc_x")
        self.assertEqual(len(alarm["conditions"]), 2)
        self.assertEqual(alarm["conditions"][1]["metric"], "angle_y")

    def test_cloud_alarm_clears_below_threshold_and_when_data_is_stale(self):
        self.module.alarm_settings = {
            "acc_x": 0.8,
            "acc_y": None,
            "angle_x": None,
            "angle_y": None,
            "angle_z": None,
        }
        state = self.module.create_device_state("2")
        state["last_seen_ms"] = 1000
        state["imu"]["acc"] = [0.9, 0.0, 0.0]
        state["imu_valid"]["acc"] = True

        self.assertIsNotNone(self.module.evaluate_cloud_alarm(state, now_ms=1000))
        state["imu"]["acc"][0] = 0.7
        self.assertIsNone(self.module.evaluate_cloud_alarm(state, now_ms=1000))
        state["imu"]["acc"][0] = 0.9
        self.assertIsNone(
            self.module.evaluate_cloud_alarm(
                state,
                now_ms=1000 + self.module.DEVICE_OFFLINE_MS,
            )
        )

    def test_zero_threshold_waits_for_real_imu_data(self):
        self.module.alarm_settings = {
            "acc_x": 0.0,
            "acc_y": None,
            "angle_x": None,
            "angle_y": None,
            "angle_z": None,
        }
        state = self.module.create_device_state("2")
        state["last_seen_ms"] = 1000
        self.assertIsNone(self.module.evaluate_cloud_alarm(state, now_ms=1000))

        self.module.apply_device_message("2", "ACC: 0 0 0 g", now_ms=1100)
        self.assertIsNotNone(self.module.devices["2"]["alarm"])

    def test_device_alarm_payload_does_not_override_cloud_alarm(self):
        self.module.alarm_settings = {
            "acc_x": 0.8,
            "acc_y": None,
            "angle_x": None,
            "angle_y": None,
            "angle_z": None,
        }
        payload = "ALARM: level=RED score=99"
        self.module.apply_device_message("2", payload, "2," + payload, now_ms=1000)
        self.assertIsNone(self.module.devices["2"]["alarm"])

    def test_alarm_settings_can_be_saved_and_loaded(self):
        settings = {
            "acc_x": 0.8,
            "acc_y": None,
            "angle_x": 15.0,
            "angle_y": None,
            "angle_z": 90.0,
        }
        with tempfile.TemporaryDirectory() as temporary_directory:
            path = Path(temporary_directory) / "alarm_settings.json"
            self.module.save_alarm_settings(settings, path)
            self.assertEqual(self.module.load_alarm_settings(path), settings)

    def test_get_alarm_settings_returns_disabled_defaults(self):
        body, status = self._response_parts(self.module.get_alarm_settings())
        self.assertEqual(status, 200)
        self.assertEqual(body["settings"]["acc_x"], None)

    def test_put_alarm_settings_persists_and_recalculates_all_devices(self):
        self.module.apply_device_message("2", "ACC: -0.9 0 0 g", now_ms=self._now_ms())
        self.module.request = types.SimpleNamespace(
            get_json=lambda silent=True: {"acc_x": 0.8, "angle_y": 30},
        )
        with tempfile.TemporaryDirectory() as temporary_directory:
            path = Path(temporary_directory) / "alarm_settings.json"
            with patch.object(self.module, "ALARM_SETTINGS_PATH", path), patch.object(
                self.module, "push_to_mini_program"
            ):
                body, status = self._response_parts(self.module.update_alarm_settings())

        self.assertEqual(status, 200)
        self.assertEqual(body["settings"]["acc_x"], 0.8)
        self.assertEqual(body["revision"], 1)
        self.assertEqual(self.module.devices["2"]["alarm"]["metric"], "acc_x")

    def test_put_alarm_settings_rejects_missing_json_without_mutation(self):
        self.module.alarm_settings["acc_x"] = 0.8
        self.module.request = types.SimpleNamespace(
            get_json=lambda silent=True: None,
        )
        body, status = self._response_parts(self.module.update_alarm_settings())
        self.assertEqual(status, 400)
        self.assertEqual(self.module.alarm_settings["acc_x"], 0.8)

    def test_put_alarm_settings_rejects_invalid_values_without_mutation(self):
        self.module.alarm_settings["acc_x"] = 0.8
        self.module.request = types.SimpleNamespace(
            get_json=lambda silent=True: {"acc_x": -1},
        )
        body, status = self._response_parts(self.module.update_alarm_settings())
        self.assertEqual(status, 400)
        self.assertIn("settings", body)
        self.assertEqual(self.module.alarm_settings["acc_x"], 0.8)

    def test_rejects_empty_or_invalid_prefixed_payload(self):
        self.assertIsNone(self.module.parse_device_message("12,"))
        self.assertIsNone(self.module.parse_device_message("A1,$GNGGA,..."))
        self.assertIsNone(self.module.parse_device_message("12,ERR: command not found."))

    def test_parses_gngga_position_quality_and_satellites(self):
        payload = "$GNGGA,094555.00,3648.62575231,N,11759.60830819,E,4,26,0.7,35.3192,M,-3.7117,M,63.0,0*7A"
        result = self.module.parse_gngga_update(payload)
        self.assertAlmostEqual(result["latitude"], 36.81042920516667)
        self.assertAlmostEqual(result["longitude"], 117.99347180316667)
        self.assertEqual(result["quality_code"], "4")
        self.assertEqual(result["quality"], "RTK 固定解")
        self.assertEqual(result["satellites"], 26)
        self.assertAlmostEqual(result["altitude"], 35.3192)

    def test_parses_alarm_fields_without_mutating_global_state(self):
        payload = "ALARM: level=YELLOW score=20.0 D=0.00mm V=0.00mm/min E=0.00mm N=0.00mm U=0.00mm tilt=14.82deg accDyn=0.004g q=4 sats=26"
        result = self.module.parse_alarm_update(payload)
        self.assertEqual(result["level"], "YELLOW")
        self.assertAlmostEqual(result["score"], 20.0)
        self.assertAlmostEqual(result["D"], 0.0)
        self.assertAlmostEqual(result["tilt"], 14.82)
        self.assertAlmostEqual(result["accDyn"], 0.004)
        self.assertEqual(result["q"], 4)
        self.assertEqual(result["sats"], 26)

    def test_accepts_and_parses_temperature_humidity_message(self):
        payload = "TEMP: 23.6 C HUM: 58.4 %RH"
        self.assertTrue(self.module.is_valid_message(payload))
        self.assertEqual(
            self.module.parse_environment_update(payload),
            {"temperature": 23.6, "humidity": 58.4},
        )

    def test_temperature_humidity_are_kept_per_device(self):
        first = "TEMP: 23.6 C HUM: 58.4 %RH"
        second = "TEMP: 19.2 C HUM: 71.0 %RH"
        self.module.apply_device_message("1", first, "1," + first, now_ms=1000)
        self.module.apply_device_message("12", second, "12," + second, now_ms=1100)

        self.assertEqual(self.module.devices["1"]["temperature"], 23.6)
        self.assertEqual(self.module.devices["1"]["humidity"], 58.4)
        self.assertEqual(self.module.devices["12"]["temperature"], 19.2)
        self.assertEqual(self.module.devices["12"]["humidity"], 71.0)

    def test_message_record_keeps_server_timestamp(self):
        payload = "TEMP: 23.6 C HUM: 58.4 %RH"
        self.module.apply_device_message("1", payload, "1," + payload, now_ms=123456)
        self.assertEqual(
            self.module.devices["1"]["messages"][-1]["server_timestamp"],
            123456,
        )

    def test_parses_split_imu_lines_into_state_updates(self):
        cases = [
            ("ACC: 0.188 -0.078 -0.958 g", "acc", [0.188, -0.078, -0.958]),
            ("GYRO: 0.012 -0.003 0.018 deg/s", "gyro", [0.012, -0.003, 0.018]),
            ("ANGLE: -3.126 -14.485 178.127 deg", "angle", [-3.126, -14.485, 178.127]),
        ]

        for line, key, expected in cases:
            with self.subTest(line=line):
                self.assertEqual(self.module.parse_imu_update(line), {key: expected})

    def test_default_ports_follow_site_port_map(self):
        self.assertEqual(self.module.HTTP_PORT, 8007)
        self.assertEqual(self.module.DEVICE_TCP_PORT, 8008)

    def test_ports_accept_environment_overrides(self):
        with patch.dict(
            "os.environ",
            {"STM32_HTTP_PORT": "18007", "STM32_TCP_PORT": "18008"},
        ):
            module = load_4g_module()

        self.assertEqual(module.HTTP_PORT, 18007)
        self.assertEqual(module.DEVICE_TCP_PORT, 18008)

    def test_updates_two_devices_without_overwriting_each_other(self):
        first = "$GNGGA,094555.00,3648.62575231,N,11759.60830819,E,4,26,0.7,35.3192,M"
        second = "$GNGGA,094555.00,3648.72575231,N,11759.70830819,E,5,18,0.9,40.0000,M"
        self.module.apply_device_message("1", first, "1," + first, now_ms=1000)
        self.module.apply_device_message("12", second, "12," + second, now_ms=1100)
        self.assertEqual(set(self.module.devices), {"1", "12"})
        self.assertEqual(self.module.devices["1"]["quality_code"], "4")
        self.assertEqual(self.module.devices["1"]["satellites"], 26)
        self.assertEqual(self.module.devices["12"]["quality_code"], "5")
        self.assertEqual(self.module.devices["12"]["satellites"], 18)
        self.assertNotEqual(
            self.module.devices["1"]["latitude"],
            self.module.devices["12"]["latitude"],
        )

    def test_snapshot_calculates_online_and_age_per_device(self):
        payload = "$GNGGA,094555.00,3648.62575231,N,11759.60830819,E,4,26,0.7,35.3192,M"
        self.module.apply_device_message("1", payload, "1," + payload, now_ms=1000)
        self.module.apply_device_message("12", payload, "12," + payload, now_ms=7000)
        snapshot = self.module.build_data_snapshot(now_ms=11000)
        self.assertFalse(snapshot["devices"]["1"]["online"])
        self.assertEqual(snapshot["devices"]["1"]["data_age_ms"], 10000)
        self.assertTrue(snapshot["devices"]["12"]["online"])
        self.assertEqual(snapshot["devices"]["12"]["data_age_ms"], 4000)

    def test_retains_last_valid_position_when_new_gngga_has_empty_coordinates(self):
        valid = "$GNGGA,094555.00,3648.62575231,N,11759.60830819,E,4,26,0.7,35.3192,M"
        invalid_position = "$GNGGA,094556.00,,,,,0,0,,0.0000,M"
        self.module.apply_device_message("1", valid, "1," + valid, now_ms=1000)
        self.module.apply_device_message(
            "1", invalid_position, "1," + invalid_position, now_ms=1100
        )
        self.assertAlmostEqual(self.module.devices["1"]["latitude"], 36.81042920516667)
        self.assertAlmostEqual(self.module.devices["1"]["longitude"], 117.99347180316667)
        self.assertEqual(self.module.devices["1"]["quality_code"], "0")

    def test_get_data_returns_full_device_snapshot(self):
        response = self.module.get_data()
        self.assertIn("devices", response)
        self.assertEqual(response["devices"], {})
        self.assertEqual(response["alarm_settings"], self.module.DEFAULT_ALARM_SETTINGS)

    def test_rebinding_same_id_replaces_old_client_and_old_cleanup_is_safe(self):
        old_client = FakeClient()
        new_client = FakeClient()
        self.module.bind_device_client(old_client, "12")
        self.module.bind_device_client(new_client, "12")
        self.assertIs(self.module.device_clients["12"], new_client)
        self.assertTrue(old_client.closed)

        self.module.remove_device_client(old_client)
        self.assertIs(self.module.device_clients["12"], new_client)
        self.module.remove_device_client(new_client)
        self.assertNotIn("12", self.module.device_clients)

    def test_superseded_old_client_cannot_reclaim_same_id(self):
        payload = "$GNGGA,094555.00,3648.62575231,N,11759.60830819,E,4,26,0.7,35.3192,M"
        old_client = FakeStreamClient([("12," + payload + "\n").encode("utf-8"), b""])
        new_client = FakeClient()
        self.module.bind_device_client(old_client, "12")
        self.module.bind_device_client(new_client, "12")

        with patch.object(self.module, "push_to_mini_program"):
            self.module.handle_client(old_client, ("old", 8008))

        self.assertIs(self.module.device_clients["12"], new_client)
        self.assertFalse(new_client.closed)

    def test_handle_client_does_not_relay_a_device_message_to_other_clients(self):
        payload = "$GNGGA,094555.00,3648.62575231,N,11759.60830819,E,4,26,0.7,35.3192,M"
        source = FakeStreamClient(
            [b"1\n", ("1," + payload + "\n").encode("utf-8"), b""]
        )
        other = FakeClient()
        self.module.active_clients.append(other)

        with patch.object(self.module, "push_to_mini_program"):
            self.module.handle_client(source, ("test", 8008))

        self.assertEqual(self.module.devices["1"]["last_message"], payload)
        self.assertEqual(other.sent, [])

    def test_send_command_targets_only_requested_device(self):
        payload = "$GNGGA,094555.00,3648.62575231,N,11759.60830819,E,4,26,0.7,35.3192,M"
        now_ms = self._now_ms()
        self.module.apply_device_message("1", payload, "1," + payload, now_ms=now_ms)
        self.module.apply_device_message("12", payload, "12," + payload, now_ms=now_ms)
        first = FakeClient()
        second = FakeClient()
        self.module.bind_device_client(first, "1")
        self.module.bind_device_client(second, "12")

        with patch.object(
            self.module,
            "request",
            types.SimpleNamespace(args={"device_id": "12", "cmd": "0"}),
        ):
            body, status = self._response_parts(self.module.send_command())

        self.assertEqual(status, 200)
        self.assertEqual(body["device_id"], "12")
        self.assertEqual(first.sent, [])
        self.assertEqual(second.sent, [b"0\r\n"])

    def test_send_command_requires_numeric_online_device(self):
        with patch.object(
            self.module,
            "request",
            types.SimpleNamespace(args={"cmd": "0"}),
        ):
            _body, status = self._response_parts(self.module.send_command())
        self.assertEqual(status, 400)

        with patch.object(
            self.module,
            "request",
            types.SimpleNamespace(args={"device_id": "12", "cmd": "0"}),
        ):
            _body, status = self._response_parts(self.module.send_command())
        self.assertEqual(status, 409)

        self.module.devices["12"] = self.module.create_device_state("12")
        with patch.object(
            self.module,
            "request",
            types.SimpleNamespace(args={"device_id": "12", "cmd": "0"}),
        ):
            _body, status = self._response_parts(self.module.send_command())
        self.assertEqual(status, 409)

    def test_send_command_rejects_non_numeric_device_id(self):
        with patch.object(
            self.module,
            "request",
            types.SimpleNamespace(args={"device_id": "A1", "cmd": "0"}),
        ):
            _body, status = self._response_parts(self.module.send_command())
        self.assertEqual(status, 400)


if __name__ == "__main__":
    unittest.main()

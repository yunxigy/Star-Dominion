import importlib.util
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch


def load_4g_module():
    root = Path(__file__).resolve().parents[1]

    eventlet = types.ModuleType("eventlet")
    eventlet.monkey_patch = lambda: None
    sys.modules.setdefault("eventlet", eventlet)

    flask = types.ModuleType("flask")
    flask.Flask = lambda *args, **kwargs: types.SimpleNamespace(route=lambda *a, **k: (lambda f: f))
    flask.jsonify = lambda *args, **kwargs: None
    flask.request = types.SimpleNamespace(args={}, remote_addr="127.0.0.1")
    sys.modules.setdefault("flask", flask)

    flask_cors = types.ModuleType("flask_cors")
    flask_cors.CORS = lambda *args, **kwargs: None
    sys.modules.setdefault("flask_cors", flask_cors)

    flask_sock = types.ModuleType("flask_sock")
    flask_sock.Sock = lambda *args, **kwargs: types.SimpleNamespace(route=lambda *a, **k: (lambda f: f))
    sys.modules.setdefault("flask_sock", flask_sock)

    spec = importlib.util.spec_from_file_location("four_g", root / "4G.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class MessageFilterTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.module = load_4g_module()

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

    def test_rejects_ack_and_error_responses(self):
        invalid_lines = ["1", "ERR: command not found.", "GET / HTTP/1.1"]

        for line in invalid_lines:
            with self.subTest(line=line):
                self.assertFalse(self.module.is_valid_message(line))

    def test_recognizes_single_digit_device_id_lines(self):
        for line in ["0", "1", "9"]:
            with self.subTest(line=line):
                self.assertTrue(self.module.is_device_id_line(line))

        for line in ["10", "A1", "ERR: 1 not found."]:
            with self.subTest(line=line):
                self.assertFalse(self.module.is_device_id_line(line))

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


if __name__ == "__main__":
    unittest.main()

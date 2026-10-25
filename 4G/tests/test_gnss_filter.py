import importlib.util
import math
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from gnss_filter import DeviceGnss, GnssService, PositionAxis, parse_gga


def gga(seconds, latitude=3648.62458, quality=4, height=38.2):
    seconds %= 86400
    utc = f'{int(seconds//3600):02d}{int(seconds//60)%60:02d}{seconds%60:05.2f}'
    body = f'GNGGA,{utc},{latitude:.8f},N,11759.61109,E,{quality},18,0.8,{height:.4f},M,-3.7115,M,4.0,0'
    checksum = 0
    for char in body:
        checksum ^= ord(char)
    return f'${body}*{checksum:02X}'


class GnssFilterTest(unittest.TestCase):
    def build_tracker(self, start=30000):
        tracker = DeviceGnss('1')
        for k in range(20):
            self.assertTrue(tracker.process(gga(start+4*k), 100000+4000*k))
        return tracker

    def test_strict_gga_quality_checksum_and_height(self):
        self.assertIsNone(parse_gga(gga(30000))[1])
        self.assertEqual(parse_gga(gga(30000, quality=5))[1], 'not_rtk_fixed')
        self.assertEqual(parse_gga(gga(30000)[:-2]+'00')[1], 'invalid_checksum')
        self.assertEqual(parse_gga(gga(30000).split('*')[0])[1], 'missing_checksum')

    def test_fixed_reference_needs_consecutive_good_epochs(self):
        tracker = DeviceGnss('1')
        for k in range(10):
            tracker.process(gga(30000+4*k), 100000+4000*k)
        self.assertEqual(tracker.snapshot(136000)['reference_progress'], 10)
        tracker.process(gga(30040, quality=5), 140000)
        self.assertEqual(tracker.snapshot(140000)['reference_progress'], 0)
        self.assertFalse(tracker.snapshot(140000)['valid'])

    def test_reference_buffer_replays_without_changing_zero_later(self):
        tracker = self.build_tracker()
        result = tracker.snapshot(176000)
        self.assertEqual(len(result['history']), 20)
        reference = result['reference_ecef_m'].copy()
        tracker.process(gga(30080, latitude=3648.62468), 180000)
        self.assertEqual(tracker.reference_ecef_m, reference)
        self.assertGreater(abs(tracker.history[-1]['raw_enu_mm'][1]), 100)

    def test_duplicate_and_out_of_order_do_not_refresh_or_update_filter(self):
        tracker = self.build_tracker()
        previous = tracker.to_state()
        self.assertFalse(tracker.process(gga(30076), 180000))
        self.assertFalse(tracker.process(gga(30072), 184000))
        self.assertEqual(tracker.sequence, 20)
        self.assertEqual(tracker.last_received_ms, previous['last_received_ms'])
        self.assertEqual([vars(a) for a in tracker.axes], previous['axes'])
        self.assertEqual(tracker.snapshot(190000)['status'], 'expired')

    def test_midnight_wrap_uses_actual_gnss_interval(self):
        tracker = self.build_tracker(start=86320)
        self.assertTrue(tracker.process(gga(0), 180000))
        self.assertEqual(tracker.history[-1]['epoch_s']-tracker.history[-2]['epoch_s'], 4)

    def test_invalid_fixed_quality_predicts_only_until_limit(self):
        tracker = self.build_tracker()
        tracker.process(gga(30080, quality=5), 180000)
        self.assertEqual(tracker.snapshot(180000)['status'], 'prediction')
        self.assertIsNotNone(tracker.snapshot(180000)['filtered_enu_mm'])
        self.assertEqual(tracker.snapshot(188000)['status'], 'expired')
        self.assertIsNone(tracker.snapshot(188000)['filtered_enu_mm'])
        self.assertEqual(tracker.sequence, 20)

    def test_long_gap_reinitializes_filter_without_resetting_reference(self):
        tracker = self.build_tracker()
        reference = tracker.reference_ecef_m.copy()
        tracker.process(gga(30100, latitude=3648.62468), 200000)
        self.assertEqual(tracker.reference_ecef_m, reference)
        self.assertEqual(tracker.history[-1]['raw_enu_mm'], tracker.history[-1]['filtered_enu_mm'])

    def test_huber_downweights_outlier_and_dt_changes_process_variance(self):
        short = PositionAxis.initialize(10, 0)
        long = PositionAxis.initialize(10, 0)
        short.update(0, 4, .8); long.update(0, 12, .8)
        self.assertGreater(long.variance_mm2, short.variance_mm2)
        outlier = PositionAxis.initialize(10, 0)
        outlier.update(500, 4, .8)
        self.assertLess(outlier.weight, 1)
        self.assertLess(outlier.position_mm, 250)
        self.assertGreater(outlier.variance_mm2, 0)

    def test_service_restores_reference_filter_and_history_by_device(self):
        with tempfile.TemporaryDirectory() as folder:
            service = GnssService(folder)
            for k in range(20):
                service.update('1', gga(30000+4*k), 100000+4000*k)
                service.update('2', gga(30000+4*k, latitude=3648.72458), 100000+4000*k)
            before = service.snapshot('1', 176000)
            restarted = GnssService(folder)
            after = restarted.update('1', gga(30080), 180000)
            self.assertEqual(after['reference_id'], before['reference_id'])
            self.assertEqual(after['reference_ecef_m'], before['reference_ecef_m'])
            self.assertEqual(after['sequence'], 21)
            self.assertEqual(len(after['history']), 21)
            self.assertNotEqual(before['reference_ecef_m'], service.snapshot('2', 176000)['reference_ecef_m'])
            self.assertEqual(len(list(Path(folder).glob('*observations.jsonl'))), 2)

    def test_corrupt_checkpoint_fails_without_creating_a_new_zero(self):
        with tempfile.TemporaryDirectory() as folder:
            (Path(folder)/'device_1.json').write_text('{broken', encoding='utf-8')
            with self.assertRaises(ValueError):
                GnssService(folder).update('1', gga(30000), 100000)
            self.assertEqual((Path(folder)/'device_1.json').read_text(), '{broken')


if __name__ == '__main__':
    unittest.main()

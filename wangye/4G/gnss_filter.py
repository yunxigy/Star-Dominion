"""Per-device fixed-reference ENU and robust adaptive position Kalman filtering.

Coordinates use WGS84 and ellipsoidal height. Filter calculations use mm.
The reference is fixed after 20 consecutive valid RTK-fixed observations.
Only the Python standard library is needed by the deployed service.
"""
import copy
from dataclasses import dataclass
import json
import logging
import math
from pathlib import Path
import re

ALGORITHM = 'robust-adaptive-position-kf-v1'
PROCESS_Q_MM2_PER_S = 0.25
BASE_SIGMA_MM = (10.0, 10.0, 20.0)
REFERENCE_EPOCHS = 20
PREDICTION_LIMIT_S = 10.0
LONG_GAP_S = 15.0
HISTORY_LIMIT = 300
LOG = logging.getLogger(__name__)


@dataclass
class PositionAxis:
    sigma_mm: float
    position_mm: float
    variance_mm2: float
    alpha: float = 1.0
    weight: float = 1.0
    innovation_mm: float = 0.0
    standardized_innovation: float = 0.0

    @classmethod
    def initialize(cls, sigma_mm, position_mm):
        return cls(sigma_mm, position_mm, sigma_mm**2)

    def update(self, measurement_mm, dt_s, hdop):
        if not all(math.isfinite(v) for v in (measurement_mm, dt_s, hdop)) or dt_s <= 0 or hdop <= 0:
            raise ValueError('finite observation, positive GNSS time interval and HDOP required')
        predicted_variance = self.variance_mm2 + PROCESS_Q_MM2_PER_S*dt_s
        rb = self.sigma_mm**2 * min(4.0, max(0.5, hdop**2))
        self.innovation_mm = measurement_mm-self.position_mm
        self.standardized_innovation = self.innovation_mm/math.sqrt(predicted_variance+rb)
        self.weight = min(1.0, 3.0/abs(self.standardized_innovation)) if self.standardized_innovation else 1.0
        scale_sample = min(25.0, max(1.0, self.standardized_innovation**2))
        self.alpha = min(25.0, max(1.0, 0.95*self.alpha+0.05*scale_sample))
        effective_variance = self.alpha*rb/self.weight
        gain = predicted_variance/(predicted_variance+effective_variance)
        self.position_mm += gain*self.innovation_mm
        self.variance_mm2 = (1-gain)**2*predicted_variance+gain**2*effective_variance
        return self.position_mm


def _number(text):
    value = float(text)
    if not math.isfinite(value):
        raise ValueError('non-finite number')
    return value


def parse_gga(sentence):
    """Strict input for displacement processing; legacy map parsing stays separate."""
    raw = str(sentence).strip()
    if not re.match(r'^\$[A-Z]{2}GGA,', raw):
        return None, 'not_gga'
    if '*' not in raw:
        return None, 'missing_checksum'
    body, checksum = raw[1:].split('*', 1)
    if not re.fullmatch(r'[0-9A-Fa-f]{2}', checksum):
        return None, 'invalid_checksum'
    calculated = 0
    for char in body:
        calculated ^= ord(char)
    if calculated != int(checksum, 16):
        return None, 'invalid_checksum'
    f = body.split(',')
    if len(f) < 14:
        return None, 'incomplete_gga'
    try:
        utc = f[1]
        if not re.fullmatch(r'\d{6}(?:\.\d+)?', utc):
            raise ValueError('invalid utc')
        hour, minute, second = int(utc[:2]), int(utc[2:4]), _number(utc[4:])
        if not (0 <= hour < 24 and 0 <= minute < 60 and 0 <= second < 60):
            raise ValueError('invalid utc')
        quality = int(f[6]); satellites = int(f[7])
        if quality != 4:
            return None, 'not_rtk_fixed'
        if satellites <= 0:
            return None, 'invalid_satellites'
        lat, lon = _number(f[2]), _number(f[4])
        if lat < 0 or lon < 0:
            raise ValueError('negative NMEA coordinate')
        lat_d, lon_d = math.floor(lat/100), math.floor(lon/100)
        lat_m, lon_m = lat % 100, lon % 100
        if not (0 <= lat_m < 60 and 0 <= lon_m < 60) or f[3] not in ('N', 'S') or f[5] not in ('E', 'W'):
            raise ValueError('invalid coordinate')
        lat = (lat_d+lat_m/60)*(-1 if f[3] == 'S' else 1)
        lon = (lon_d+lon_m/60)*(-1 if f[5] == 'W' else 1)
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            raise ValueError('coordinate outside range')
        hdop = _number(f[8])
        if hdop <= 0 or f[10] != 'M' or f[12] != 'M':
            raise ValueError('invalid HDOP or height units')
        altitude, geoid = _number(f[9]), _number(f[11])
        age = _number(f[13]) if f[13] else None
        if age is not None and age < 0:
            raise ValueError('invalid differential age')
    except (ValueError, OverflowError, IndexError):
        return None, 'invalid_observation_fields'
    return {'utc': utc, 'utc_sod': hour*3600+minute*60+second, 'latitude_deg': lat,
            'longitude_deg': lon, 'height_ellipsoid_m': altitude+geoid,
            'hdop': hdop, 'satellites': satellites, 'diff_age_s': age,
            'checksum_ok': True, 'raw_gga': raw}, None


def geodetic_to_ecef(latitude_deg, longitude_deg, height_m):
    phi, lam = math.radians(latitude_deg), math.radians(longitude_deg)
    a, f = 6378137.0, 1/298.257223563
    e2 = f*(2-f); nu = a/math.sqrt(1-e2*math.sin(phi)**2)
    return [(nu+height_m)*math.cos(phi)*math.cos(lam),
            (nu+height_m)*math.cos(phi)*math.sin(lam),
            (nu*(1-e2)+height_m)*math.sin(phi)]


def reference_rotation(xyz):
    e2 = (1/298.257223563)*(2-1/298.257223563)
    p = math.hypot(xyz[0], xyz[1]); lam = math.atan2(xyz[1], xyz[0])
    phi = math.atan2(xyz[2], p*(1-e2))
    for _ in range(12):
        nu = 6378137/math.sqrt(1-e2*math.sin(phi)**2)
        phi = math.atan2(xyz[2]+e2*nu*math.sin(phi), p)
    return [[-math.sin(lam), math.cos(lam), 0.0],
            [-math.sin(phi)*math.cos(lam), -math.sin(phi)*math.sin(lam), math.cos(phi)],
            [math.cos(phi)*math.cos(lam), math.cos(phi)*math.sin(lam), math.sin(phi)]]


class DeviceGnss:
    def __init__(self, device_id):
        self.device_id = str(device_id)
        self.reference_ecef_m = None
        self.rotation = None
        self.reference_id = None
        self.initial_observations = []
        self.axes = []
        self.history = []
        self.sequence = 0
        self.last_utc_sod = None
        self.last_epoch_s = None
        self.last_received_ms = None
        self.last_observation = None
        self.last_rejection = None
        self.last_input_valid = False
        self.persistence_error = False

    def _append(self, observation, epoch_s, received_ms, dt_s):
        xyz = geodetic_to_ecef(observation['latitude_deg'], observation['longitude_deg'], observation['height_ellipsoid_m'])
        delta = [xyz[j]-self.reference_ecef_m[j] for j in range(3)]
        raw = [1000*sum(row[j]*delta[j] for j in range(3)) for row in self.rotation]
        if not self.axes or dt_s > LONG_GAP_S:
            self.axes = [PositionAxis.initialize(sigma, position) for sigma, position in zip(BASE_SIGMA_MM, raw)]
        else:
            for axis, value in zip(self.axes, raw):
                axis.update(value, dt_s, observation['hdop'])
        self.sequence += 1
        point = {'sequence': self.sequence, 'epoch_s': epoch_s, 'utc': observation['utc'],
                 'received_ms': received_ms, 'raw_enu_mm': raw,
                 'filtered_enu_mm': [axis.position_mm for axis in self.axes]}
        self.history = (self.history+[point])[-HISTORY_LIMIT:]

    def process(self, sentence, received_ms):
        observation, error = parse_gga(sentence)
        if error:
            self.last_rejection = error
            self.last_input_valid = False
            if self.reference_ecef_m is None:
                self.initial_observations.clear()
            return False
        sod = observation['utc_sod']
        dt_s = 0.0
        if self.last_utc_sod is not None:
            dt_s = sod-self.last_utc_sod
            wall_gap = max(0.0, (received_ms-self.last_received_ms)/1000)
            if wall_gap > 43200:
                # GGA has no date: reconstruct a new session after a long absence.
                dt_s = wall_gap
            elif dt_s < -43200:
                dt_s += 86400
            elif dt_s < 0 or dt_s > 43200:
                self.last_rejection = 'out_of_order_epoch'
                return False
            elif dt_s == 0:
                self.last_rejection = 'duplicate_epoch'
                return False
        epoch_s = sod if self.last_epoch_s is None else self.last_epoch_s+dt_s
        self.last_rejection = None; self.last_input_valid = True
        self.last_utc_sod = sod; self.last_epoch_s = epoch_s; self.last_received_ms = received_ms
        self.last_observation = observation
        if self.reference_ecef_m is None:
            if dt_s > LONG_GAP_S:
                self.initial_observations.clear()
            self.initial_observations.append({'observation': observation, 'epoch_s': epoch_s, 'received_ms': received_ms})
            if len(self.initial_observations) < REFERENCE_EPOCHS:
                return True
            coords = [geodetic_to_ecef(i['observation']['latitude_deg'], i['observation']['longitude_deg'],
                                       i['observation']['height_ellipsoid_m']) for i in self.initial_observations]
            self.reference_ecef_m = [sum(row[j] for row in coords)/len(coords) for j in range(3)]
            self.rotation = reference_rotation(self.reference_ecef_m)
            self.reference_id = f'{self.device_id}:{received_ms}'
            previous_epoch = None
            for item in self.initial_observations:
                interval = 0.0 if previous_epoch is None else item['epoch_s']-previous_epoch
                self._append(item['observation'], item['epoch_s'], item['received_ms'], interval)
                previous_epoch = item['epoch_s']
            self.initial_observations.clear()
        else:
            self._append(observation, epoch_s, received_ms, dt_s)
        return True

    def snapshot(self, now_ms):
        age_s = max(0.0, (now_ms-self.last_received_ms)/1000) if self.last_received_ms is not None else None
        status = 'no_data'
        if self.reference_ecef_m is None and self.initial_observations:
            status = 'reference_building'
        elif self.axes:
            if self.last_input_valid and age_s <= 5:
                status = 'measured'
            elif age_s <= PREDICTION_LIMIT_S:
                status = 'prediction'
            else:
                status = 'expired'
        valid = status in ('measured', 'prediction')
        return {'algorithm': ALGORITHM, 'status': status, 'valid': valid,
                'reference_id': self.reference_id, 'reference_ecef_m': self.reference_ecef_m,
                'reference_progress': REFERENCE_EPOCHS if self.reference_ecef_m else len(self.initial_observations),
                'reference_required': REFERENCE_EPOCHS, 'sequence': self.sequence,
                'observation_age_s': age_s, 'last_rejection': self.last_rejection,
                'persistence_error': self.persistence_error,
                'utc': self.last_observation['utc'] if self.last_observation else None,
                'hdop': self.last_observation['hdop'] if self.last_observation else None,
                'diff_age_s': self.last_observation['diff_age_s'] if self.last_observation else None,
                'raw_enu_mm': self.history[-1]['raw_enu_mm'] if self.history and status == 'measured' else None,
                'filtered_enu_mm': [a.position_mm for a in self.axes] if valid else None,
                'axis_diagnostics': [{**vars(a), 'prediction_variance_mm2': a.variance_mm2+PROCESS_Q_MM2_PER_S*(age_s or 0)}
                                     for a in self.axes],
                'history': copy.deepcopy(self.history)}

    def to_state(self):
        return {'algorithm': ALGORITHM, **{k: copy.deepcopy(v) for k, v in vars(self).items() if k != 'axes'},
                'axes': [vars(a).copy() for a in self.axes]}

    @classmethod
    def from_state(cls, device_id, state):
        if state.get('algorithm') != ALGORITHM or str(state.get('device_id')) != str(device_id):
            raise ValueError('incompatible GNSS checkpoint')
        tracker = cls(device_id)
        for key in vars(tracker):
            if key in state and key != 'axes':
                setattr(tracker, key, state[key])
        tracker.axes = [PositionAxis(**item) for item in state.get('axes', [])]
        if len(tracker.axes) not in (0, 3) or any(not math.isfinite(a.position_mm) or
              not math.isfinite(a.variance_mm2) or a.variance_mm2 <= 0 or not 1 <= a.alpha <= 25 for a in tracker.axes):
            raise ValueError('invalid GNSS filter checkpoint')
        if tracker.reference_ecef_m is not None:
            if len(tracker.reference_ecef_m) != 3 or not all(math.isfinite(v) for v in tracker.reference_ecef_m):
                raise ValueError('invalid GNSS reference')
            tracker.rotation = reference_rotation(tracker.reference_ecef_m)
        return tracker


class GnssService:
    def __init__(self, state_dir):
        self.state_dir = Path(state_dir)
        self.trackers = {}

    def _tracker(self, device_id):
        device_id = str(device_id)
        if not re.fullmatch(r'\d+', device_id):
            raise ValueError('numeric device id required')
        if device_id not in self.trackers:
            tracker = DeviceGnss(device_id)
            path = self.state_dir/f'device_{device_id}.json'
            if path.exists():
                try:
                    tracker = DeviceGnss.from_state(device_id, json.loads(path.read_text(encoding='utf-8')))
                except (OSError, ValueError, TypeError, KeyError):
                    # Never silently replace a saved reference with a new zero.
                    tracker.persistence_error = True
                    LOG.warning('GNSS checkpoint could not be restored for device %s', device_id)
                    raise ValueError('GNSS checkpoint requires inspection')
            self.trackers[device_id] = tracker
        return self.trackers[device_id]

    def update(self, device_id, sentence, now_ms):
        tracker = self._tracker(device_id)
        accepted = tracker.process(sentence, now_ms)
        if tracker.reference_ecef_m is not None or tracker.initial_observations:
            try:
                self.state_dir.mkdir(parents=True, exist_ok=True)
                target = self.state_dir/f'device_{device_id}.json'
                temporary = target.with_suffix('.tmp')
                tracker.persistence_error = False
                temporary.write_text(json.dumps(tracker.to_state(), ensure_ascii=False, allow_nan=False), encoding='utf-8')
                temporary.replace(target)
                record = {'device_id': str(device_id), 'received_ms': now_ms, 'raw_gga': sentence,
                          'accepted': accepted, **tracker.snapshot(now_ms)}
                record.pop('history', None)
                with (self.state_dir/f'device_{device_id}_observations.jsonl').open('a', encoding='utf-8') as stream:
                    stream.write(json.dumps(record, ensure_ascii=False, allow_nan=False)+'\n')
            except OSError:
                tracker.persistence_error = True
                LOG.warning('GNSS checkpoint or observation log could not be saved for device %s', device_id)
        return tracker.snapshot(now_ms)

    def snapshot(self, device_id, now_ms):
        tracker = self.trackers.get(str(device_id))
        return tracker.snapshot(now_ms) if tracker else None

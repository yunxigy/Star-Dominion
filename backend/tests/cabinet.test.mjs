import test from 'node:test';
import assert from 'node:assert/strict';
import { Cabinet, calibrate } from '../cabinet.mjs';

const config = { rawEmpty: 8000000, rawLoaded: 8100000, knownGrams: 1000, bottleGrams: 550 };
function rig(options = config) {
  let now = 1000;
  const cabinet = new Cabinet('CABINET001', options, () => now);
  cabinet.connect();
  cabinet.door('LOCKED');
  const sample = (grams) => { now += 250; cabinet.raw(8000000 + grams * 100); };
  const stable = (grams) => { for (let i = 0; i < 6; i++) sample(grams); };
  return { cabinet, sample, stable, advance: (ms) => { now += ms; cabinet.tick(); } };
}

test('calibration supports a decreasing ADC scale and rejects invalid parameters', () => {
  assert.equal(calibrate({ ...config, rawLoaded: 7900000 }).countsPerGram, -100);
  for (const patch of [{ rawLoaded: 8000000 }, { knownGrams: 0 }, { bottleGrams: 0 }, { rawEmpty: -1 }, { rawLoaded: 17000000 }]) {
    assert.throws(() => calibrate({ ...config, ...patch }));
  }
});

test('take two, put one back, close: quantity is net removal and finalizes after fresh stable samples', () => {
  const { cabinet: c, stable, sample } = rig();
  stable(5500);
  const s = c.unlock('request-a');
  assert.equal(s.phase, 'UNLOCKING');
  assert.equal(c.snapshot(s.id).doorStatus, 'LOCKED');
  c.ack();
  assert.equal(c.snapshot(s.id).session.phase, 'UNLOCKING');
  c.door('OPEN'); stable(4400);
  assert.equal(c.snapshot(s.id).session.quantity, 2);
  stable(4950);
  assert.equal(c.snapshot(s.id).session.quantity, 1);
  c.door('LOCKED');
  assert.equal(c.snapshot(s.id).session.phase, 'SETTLING');
  sample(4950);
  assert.equal(c.snapshot(s.id).session.phase, 'SETTLING');
  stable(4950);
  assert.equal(c.snapshot(s.id).session.phase, 'COMPLETED');
  assert.equal(c.snapshot(s.id).session.quantity, 1);
});

test('repeat registration preserves telemetry and request id makes unlock idempotent', () => {
  const { cabinet: c, stable } = rig(); stable(5500);
  const s = c.unlock('same-request');
  c.register();
  assert.equal(c.snapshot(s.id).doorStatus, 'LOCKED');
  assert.equal(c.unlock('same-request').id, s.id);
  assert.throws(() => c.unlock('another-request'), /正在/);
  assert.equal(c.snapshot().session, null);
  assert.equal(c.snapshot('wrong-session').session, null);
});

test('uncalibrated sensor never invents grams or bottle quantity but allows door testing', () => {
  const { cabinet: c, stable } = rig({}); stable(5500);
  const s = c.unlock('uncalibrated'); c.door('OPEN'); stable(4400);
  const snap = c.snapshot(s.id);
  assert.equal(snap.weight, null);
  assert.equal(snap.calibrated, false);
  assert.equal(snap.session.quantity, null);
  assert.equal(snap.session.recognition, 'UNCALIBRATED');
});

test('sensor failure immediately invalidates weight and blocks opening until recovered', () => {
  const { cabinet: c, stable } = rig(); stable(5500); c.sensorError();
  assert.equal(c.snapshot().weight, null);
  assert.throws(() => c.unlock('broken-sensor'), /称重/);
  stable(5500); assert.equal(c.unlock('recovered').phase, 'UNLOCKING');
});

test('stale baseline, unknown door and offline device cannot start a purchase', () => {
  const { cabinet: c, stable, advance } = rig(); stable(5500); advance(4000);
  assert.throws(() => c.unlock('stale'), /称重/);
  stable(5500); c.disconnect();
  assert.throws(() => c.unlock('offline'), /离线/);
});

test('non bottle removal or added weight is flagged for review rather than rounded into a purchase', () => {
  const { cabinet: c, stable } = rig(); stable(5500);
  const s = c.unlock('abnormal'); c.door('OPEN'); stable(5240);
  assert.equal(c.snapshot(s.id).session.quantity, null);
  assert.equal(c.snapshot(s.id).session.recognition, 'REVIEW');
  stable(6050);
  assert.equal(c.snapshot(s.id).session.recognition, 'REVIEW');
});

test('unlock timeout, unsettled close and network interruption cannot report a completed purchase', () => {
  const a = rig(); a.stable(5500); const sa = a.cabinet.unlock('timeout');
  a.advance(13000); assert.equal(a.cabinet.snapshot(sa.id).session.phase, 'FAILED');
  const b = rig(); b.stable(5500); const sb = b.cabinet.unlock('offline');
  b.cabinet.door('OPEN'); b.cabinet.disconnect();
  assert.equal(b.cabinet.snapshot(sb.id).session.phase, 'INTERRUPTED');
  const c = rig(); c.stable(5500); const sc = c.cabinet.unlock('unstable');
  c.cabinet.door('OPEN'); c.cabinet.door('LOCKED'); c.advance(16000);
  assert.equal(c.cabinet.snapshot(sc.id).session.phase, 'REVIEW_REQUIRED');
});

test('old completed session stays isolated when a new customer opens the same cabinet', () => {
  const { cabinet: c, stable } = rig(); stable(5500);
  const old = c.unlock('first'); c.door('OPEN'); stable(4950); c.door('LOCKED'); stable(4950);
  const next = c.unlock('second');
  assert.notEqual(old.id, next.id);
  assert.equal(c.snapshot(old.id).session.quantity, 1);
  assert.equal(c.snapshot(next.id).session.quantity, 0);
});

test('missing fresh samples clears the live count even while the TCP link remains connected', () => {
  const { cabinet: c, stable, advance } = rig(); stable(5500);
  const s = c.unlock('stale-active'); c.door('OPEN'); stable(4400);
  assert.equal(c.snapshot(s.id).session.quantity, 2);
  advance(3500);
  const state = c.snapshot(s.id);
  assert.equal(state.online, true);
  assert.equal(state.session.quantity, null);
  assert.equal(state.session.recognition, 'SENSOR_ERROR');
});

test('delayed physical opening resumes only the last request when its baseline is still intact', () => {
  const { cabinet: c, stable, advance } = rig(); stable(5500);
  const s = c.unlock('late-opening'); advance(13000);
  assert.equal(c.snapshot(s.id).session.phase, 'FAILED');
  stable(5500); c.door('OPEN'); stable(4950); c.door('LOCKED'); stable(4950);
  assert.equal(c.snapshot(s.id).session.phase, 'COMPLETED');
  assert.equal(c.snapshot(s.id).session.quantity, 1);
});

test('late opening with an uncertain baseline requests review instead of fabricating a count', () => {
  const { cabinet: c, stable, advance } = rig(); stable(5500);
  const s = c.unlock('late-untrusted'); advance(13000); stable(4400); c.door('OPEN');
  assert.equal(c.snapshot(s.id).session.phase, 'REVIEW_REQUIRED');
  assert.equal(c.snapshot(s.id).session.quantity, null);
});

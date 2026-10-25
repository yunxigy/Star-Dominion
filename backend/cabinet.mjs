import { randomUUID } from 'node:crypto';

export const ACTIVE = new Set(['UNLOCKING', 'OPEN', 'SETTLING']);
const SAMPLE_FRESH_MS = 3000;
const DOOR_FRESH_MS = 25000;

export function calibrate(input) {
  const { rawEmpty, rawLoaded, knownGrams, bottleGrams } = input;
  if (![rawEmpty, rawLoaded].every(n => Number.isInteger(n) && n >= 0 && n <= 0xffffff)
      || rawEmpty === rawLoaded || !Number.isFinite(knownGrams) || knownGrams <= 0
      || !Number.isFinite(bottleGrams) || bottleGrams <= 80 || bottleGrams > 50000) {
    throw new Error('请填写有效的空载值、负载值、已知重量及整瓶毛重（大于 80 克）');
  }
  return { rawEmpty, rawLoaded, knownGrams, bottleGrams,
    countsPerGram: (rawLoaded - rawEmpty) / knownGrams };
}

export class Cabinet {
  constructor(id, config = {}, clock = Date.now) {
    this.id = id;
    this.clock = clock;
    this.config = config.rawEmpty != null ? calibrate(config) : null;
    this.online = false;
    this.doorStatus = 'UNKNOWN';
    this.doorAt = null;
    this.rawValue = null;
    this.sampleAt = null;
    this.sensorFault = false;
    this.samples = [];
    this.sessions = [];
    this.current = null;
    this.lastSeen = null;
  }

  connect() {
    this.online = true;
    this.register();
    this.doorStatus = 'UNKNOWN'; this.doorAt = null;
    this.clearSamples();
  }
  register() { this.lastSeen = this.clock(); }
  clearSamples() { this.samples = []; this.sampleAt = null; this.rawValue = null; }
  disconnect() {
    this.online = false;
    this.clearSamples();
    if (this.current && ACTIVE.has(this.current.phase)) this.finish('INTERRUPTED', '设备连接中断，请核对本次取水');
  }
  sensorError() { this.sensorFault = true; this.clearSamples(); if (this.current && ACTIVE.has(this.current.phase)) {
    this.current.quantity = null; this.current.recognition = 'SENSOR_ERROR';
  } }
  ack() { if (this.current?.phase === 'UNLOCKING') this.current.acknowledged = true; }

  isFresh() { return !this.sensorFault && this.sampleAt !== null && this.clock() - this.sampleAt <= SAMPLE_FRESH_MS; }
  stableRaw() {
    if (!this.isFresh() || this.samples.length < 3) return null;
    const window = this.samples.slice(-3);
    if (window[2].at - window[0].at < 450) return null;
    const values = window.map(s => s.value);
    const threshold = this.config ? Math.abs(this.config.countsPerGram) * 8 : 1000;
    if (Math.max(...values) - Math.min(...values) > threshold) return null;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }
  grams(raw) { return this.config && raw !== null ? (raw - this.config.rawEmpty) / this.config.countsPerGram : null; }

  raw(value) {
    if (!Number.isInteger(value) || value < 0 || value > 0xffffff) { this.sensorError(); return; }
    const now = this.clock();
    if (this.sampleAt !== null && now - this.sampleAt > SAMPLE_FRESH_MS) this.samples = [];
    this.sensorFault = false; this.rawValue = value; this.sampleAt = now; this.lastSeen = now;
    this.samples.push({ value, at: now });
    this.samples = this.samples.slice(-3);
    const s = this.current;
    if (!s || !['OPEN', 'SETTLING'].includes(s.phase)) return;
    const stable = this.stableRaw();
    if (stable === null) { s.recognition = this.config ? 'UNSTABLE' : 'UNCALIBRATED'; s.quantity = null; return; }
    if (!this.config) { s.quantity = null; s.recognition = 'UNCALIBRATED'; }
    else if (s.baselineRaw === null) { s.quantity = null; s.recognition = 'REVIEW'; }
    else {
      const delta = (s.baselineRaw - stable) / this.config.countsPerGram;
      const quantity = Math.round(delta / this.config.bottleGrams);
      const valid = quantity >= 0 && Math.abs(delta - quantity * this.config.bottleGrams) <= 35;
      s.quantity = valid ? quantity : null;
      s.recognition = valid ? 'OK' : 'REVIEW';
      s.removedGrams = Math.round(delta * 10) / 10;
    }
    if (s.phase === 'SETTLING' && now - s.closedAt >= 1000 && this.samples[0].at > s.closedAt) {
      this.finish(s.recognition === 'OK' ? 'COMPLETED' : 'REVIEW_REQUIRED',
        s.recognition === 'UNCALIBRATED' ? '设备待标定，瓶数尚未确认' : s.recognition === 'OK' ? '门已关上，本次取水已确认' : '重量不符合整瓶水，请核对');
    }
  }

  door(status) {
    if (!['OPEN', 'LOCKED'].includes(status)) return;
    const changed = this.doorStatus !== status;
    this.doorStatus = status; this.doorAt = this.clock(); this.lastSeen = this.clock();
    const s = this.current;
    if (!changed || !s) return;
    if (status === 'OPEN' && s.phase === 'FAILED' && s.openedAt === null) {
      const stable = this.stableRaw();
      const tolerance = this.config ? Math.abs(this.config.countsPerGram) * 8 : 1000;
      if (this.clock() - s.startedAt <= 90000 && stable !== null && Math.abs(stable - s.baselineRaw) <= tolerance) {
        // A late sense-pin event can recover the same request; never resend OPEN.
        s.phase = 'UNLOCKING'; s.completedAt = null;
      } else {
        this.finish('REVIEW_REQUIRED', '收到延迟开门反馈，但重量基线无法确认，请现场核对');
      }
    }
    if (status === 'OPEN' && ['UNLOCKING', 'SETTLING'].includes(s.phase)) {
      s.phase = 'OPEN'; s.openedAt = this.clock(); s.closedAt = null; this.samples = [];
    } else if (status === 'LOCKED' && s.phase === 'OPEN') {
      s.phase = 'SETTLING'; s.closedAt = this.clock(); this.samples = [];
      s.quantity = null; s.recognition = this.config ? 'UNSTABLE' : 'UNCALIBRATED';
    }
  }

  unlock(requestId) {
    this.tick();
    const duplicate = this.sessions.find(s => s.requestId === requestId);
    if (duplicate) return duplicate;
    if (!this.online) throw new Error('设备离线，请稍后再试');
    if (this.current && ACTIVE.has(this.current.phase)) throw new Error('柜子正在取水，请等待本次完成');
    if (this.doorStatus !== 'LOCKED' || this.doorAt === null || this.clock() - this.doorAt > DOOR_FRESH_MS) throw new Error('请先确认柜门已关上');
    const baselineRaw = this.stableRaw();
    if (baselineRaw === null) throw new Error('称重尚未稳定或无新数据，请稍候');
    const s = { id: randomUUID(), requestId, phase: 'UNLOCKING', startedAt: this.clock(),
      baselineRaw, quantity: this.config ? 0 : null, recognition: this.config ? 'OK' : 'UNCALIBRATED',
      acknowledged: false, openedAt: null, closedAt: null, completedAt: null, message: '正在等待柜门打开' };
    this.current = s; this.sessions.push(s); this.sessions = this.sessions.slice(-50);
    return s;
  }
  finish(phase, message) {
    this.current.phase = phase; this.current.message = message; this.current.completedAt = this.clock();
    if (phase !== 'COMPLETED') this.current.quantity = null;
  }
  tick() {
    const s = this.current;
    if (s?.phase === 'UNLOCKING' && this.clock() - s.startedAt > 12000) this.finish('FAILED', '未收到开门反馈，请检查柜门');
    if (s?.phase === 'SETTLING' && this.clock() - s.closedAt > 15000) this.finish('REVIEW_REQUIRED', '柜门已关上，但称重未稳定，请核对');
    if (s?.phase === 'OPEN' && this.clock() - s.openedAt > 10 * 60000) this.finish('REVIEW_REQUIRED', '柜门长时间未关闭，请现场处理');
  }
  snapshot(sessionId) {
    this.tick();
    if (this.current && ACTIVE.has(this.current.phase) && !this.isFresh()) {
      this.current.quantity = null;
      this.current.recognition = 'SENSOR_ERROR';
    }
    const session = this.sessions.find(s => s.id === sessionId);
    const { requestId, ...publicSession } = session || {};
    const freshDoor = this.online && this.doorAt !== null && this.clock() - this.doorAt <= DOOR_FRESH_MS;
    return { code: 0, deviceId: this.id, online: this.online, doorStatus: freshDoor ? this.doorStatus : 'UNKNOWN',
      raw: this.rawValue, weight: this.isFresh() ? this.grams(this.rawValue) : null, sensorOk: this.isFresh(),
      weightStable: this.stableRaw() !== null, calibrated: !!this.config,
      product: { name: '瓶装饮用水', bottleGrams: this.config?.bottleGrams ?? null },
      lastSeen: this.lastSeen, busy: !!this.current && ACTIVE.has(this.current.phase),
      session: session ? structuredClone(publicSession) : null };
  }
  serialize() { return this.sessions.map(s => ({ ...s })); }
  restore(sessions) {
    this.sessions = sessions.slice(-50).map(s => ({ ...s }));
    this.current = this.sessions.at(-1) || null;
    if (this.current && ACTIVE.has(this.current.phase)) this.finish('INTERRUPTED', '服务重启，本次取水需人工核对');
  }
}

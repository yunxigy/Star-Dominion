/** TCP 9001: REG / RAW / STATUS / OK; HTTP 38080: customer API + maintenance page. */
import net from 'node:net';
import http from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import { Cabinet, ACTIVE, calibrate } from './cabinet.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
function readJson(file) { return file && existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}; }
function atomicJson(file, value) {
  if (!file) return;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 2));
  renameSync(`${file}.tmp`, file);
}
function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,X-Admin-Token' });
  res.end(status === 204 ? undefined : JSON.stringify(body));
}
async function readBody(req) {
  let body = '';
  for await (const chunk of req) { body += chunk; if (body.length > 8192) throw new Error('请求内容过长'); }
  try { return JSON.parse(body); } catch { throw new Error('请求必须为 JSON'); }
}
function authorized(req, token) {
  const supplied = req.headers['x-admin-token'];
  if (!token || typeof supplied !== 'string') return false;
  const a = Buffer.from(supplied), b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createBackend(options = {}) {
  const clock = options.clock || Date.now;
  const adminToken = options.adminToken ?? process.env.ADMIN_TOKEN ?? '';
  const calibrationFile = options.calibrationFile === undefined ? path.join(here, 'data/calibration.json') : options.calibrationFile;
  const sessionFile = options.sessionFile === undefined ? path.join(here, 'data/sessions.json') : options.sessionFile;
  const configs = { ...readJson(calibrationFile), ...options.configs };
  const devices = new Map();
  const sockets = new Set();
  const saved = readJson(sessionFile);
  function getDevice(id) {
    if (!devices.has(id)) {
      const dev = new Cabinet(id, configs[id], clock);
      if (saved[id]) dev.restore(saved[id]);
      devices.set(id, dev);
    }
    return devices.get(id);
  }
  for (const id of Object.keys(saved)) if (validId(id)) getDevice(id);
  function persist() { atomicJson(sessionFile, Object.fromEntries([...devices].map(([id, dev]) => [id, dev.serialize()]))); }
  function backgroundPersist(dev) {
    try { persist(); }
    catch (error) {
      console.error('[STORAGE] Failed to save sessions:', error.message);
      if (dev?.current) dev.finish('REVIEW_REQUIRED', '取水记录保存失败，请联系维护人员核对');
    }
  }
  function snapshot(dev, sessionId) {
    const phase = dev.current?.phase;
    let state = dev.snapshot(sessionId);
    if (phase !== dev.current?.phase) { backgroundPersist(dev); state = dev.snapshot(sessionId); }
    return state;
  }
  persist();

  const tcp = net.createServer(socket => {
    sockets.add(socket);
    let device = null, buffer = '';
    socket.setKeepAlive(true, 30000);
    socket.setTimeout(90000, () => socket.destroy());
    socket.on('data', chunk => {
      buffer += chunk.toString('ascii');
      while (buffer.includes('\n')) {
        const end = buffer.indexOf('\n');
        if (end > 256) { socket.destroy(); return; }
        const line = buffer.slice(0, end).replace(/\r$/, '').trim(); buffer = buffer.slice(end + 1);
        if (!line) continue;
        if (line.startsWith('REG:')) {
          const id = line.slice(4);
          if (!validId(id) || (device && device.id !== id)) { socket.destroy(); return; }
          if (device) { device.register(); continue; }
          device = getDevice(id);
          if (device.socket && device.socket !== socket) { device.disconnect(); device.socket.destroy(); backgroundPersist(device); }
          device.socket = socket; device.connect();
          console.log(`[TCP] registered ${id}`);
          continue;
        }
        if (!device || device.socket !== socket) continue;
        const phase = device.current?.phase;
        if (line === 'PING') { device.register(); socket.write('PONG\n'); }
        else if (line === 'OK') { device.register(); device.ack(); }
        else if (line === 'STATUS:OPEN') device.door('OPEN');
        else if (line === 'STATUS:LOCKED') device.door('LOCKED');
        else if (/^RAW:\d+$/.test(line)) device.raw(Number(line.slice(4)));
        else if (line === 'SENSOR:ERROR' || line === 'HX711_NO_DATA' || line.startsWith('WEIGHT:')) device.sensorError();
        if (phase !== device.current?.phase) backgroundPersist(device);
      }
      if (buffer.length > 256) socket.destroy();
    });
    socket.on('close', () => {
      sockets.delete(socket);
      if (device?.socket === socket) { device.socket = null; device.disconnect(); backgroundPersist(device); }
    });
    socket.on('error', error => console.error(`[TCP] ${device?.id || 'unregistered'}: ${error.message}`));
  });

  const web = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'OPTIONS') { json(res, 204); return; }
      if (req.method === 'GET' && url.pathname === '/api/health') { json(res, 200, { code: 0, protocol: 2 }); return; }
      if (req.method === 'GET' && url.pathname === '/api/devices') {
        json(res, 200, { code: 0, devices: [...devices.values()].map(dev => snapshot(dev)) }); return;
      }
      if (req.method === 'GET' && url.pathname === '/api/status') {
        const id = url.searchParams.get('deviceId');
        if (!validId(id)) { json(res, 400, { code: 1, msg: '设备编号格式不正确' }); return; }
        const dev = devices.get(id) || new Cabinet(id, configs[id], clock);
        const recovery = url.searchParams.get('requestId');
        const sessionId = url.searchParams.get('sessionId') || (recovery && dev.sessions.find(s => s.requestId === recovery)?.id);
        const state = snapshot(dev, sessionId);
        json(res, 200, state); return;
      }
      if (req.method === 'POST' && url.pathname === '/api/unlock') {
        const { deviceId, requestId } = await readBody(req);
        if (!validId(deviceId) || typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(requestId)) {
          json(res, 400, { code: 1, msg: '设备编号或请求编号格式不正确' }); return;
        }
        const dev = devices.get(deviceId);
        if (!dev) { json(res, 409, { code: 1, msg: '设备离线，请稍后再试' }); return; }
        const duplicate = dev.sessions.some(s => s.requestId === requestId);
        let session;
        try { session = dev.unlock(requestId); } catch (error) { json(res, 409, { code: 1, msg: error.message }); return; }
        if (!duplicate) {
          try { persist(); } catch (error) { dev.sessions.pop(); dev.current = dev.sessions.at(-1) || null; throw error; }
          if (!dev.socket || dev.socket.destroyed || !dev.socket.writable) {
            dev.disconnect(); persist(); json(res, 409, { code: 1, msg: '设备连接已断开' }); return;
          }
          dev.socket.write('OPEN\n');
        } else backgroundPersist(dev);
        json(res, 200, { code: 0, msg: duplicate ? '已恢复本次取水' : '指令已下发，等待柜门反馈', sessionId: session.id, ...snapshot(dev, session.id) });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/calibration') {
        if (!authorized(req, adminToken)) { json(res, 403, { code: 1, msg: '需要配置并提供管理令牌 ADMIN_TOKEN' }); return; }
        const input = await readBody(req);
        if (!validId(input.deviceId)) { json(res, 400, { code: 1, msg: '设备编号格式不正确' }); return; }
        const dev = getDevice(input.deviceId);
        if (dev.current && ACTIVE.has(dev.current.phase)) { json(res, 409, { code: 1, msg: '取水进行中，不能修改标定' }); return; }
        let config;
        try { config = calibrate(input); } catch (error) { json(res, 400, { code: 1, msg: error.message }); return; }
        atomicJson(calibrationFile, { ...configs, [input.deviceId]: config });
        configs[input.deviceId] = config; dev.config = config; dev.clearSamples();
        json(res, 200, { code: 0, msg: '标定已保存，等待新称重数据', config }); return;
      }
      if (req.method === 'GET' && ['/', '/index.html', '/admin'].includes(url.pathname)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(readFileSync(path.join(here, 'public/index.html'))); return;
      }
      json(res, 404, { code: 404, msg: 'Not Found' });
    } catch (error) {
      console.error('[HTTP]', error.message);
      if (!res.headersSent) json(res, error.message.startsWith('请求') ? 400 : 500, { code: 1, msg: error.message.startsWith('请求') ? error.message : '服务暂时不可用' });
      else res.end();
    }
  });
  let timer;
  return {
    devices,
    async listen() {
      const bind = (server, port) => new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, options.host || '0.0.0.0', () => { server.removeListener('error', reject); resolve(); });
      });
      await bind(tcp, options.tcpPort ?? Number(process.env.TCP_PORT || 9001));
      try { await bind(web, options.httpPort ?? Number(process.env.HTTP_PORT || 38080)); }
      catch (error) { await new Promise(r => tcp.close(r)); throw error; }
      timer = setInterval(() => { for (const dev of devices.values()) { const phase = dev.current?.phase; dev.tick(); if (phase !== dev.current?.phase) backgroundPersist(dev); } }, 500).unref();
      return { tcpPort: tcp.address().port, httpPort: web.address().port };
    },
    async close() {
      clearInterval(timer);
      for (const socket of sockets) socket.destroy();
      web.closeAllConnections?.();
      await Promise.all([tcp, web].map(server => new Promise(r => server.close(r))));
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const backend = createBackend();
  backend.listen().then(ports => console.log(`[READY] TCP ${ports.tcpPort}; HTTP ${ports.httpPort}`)).catch(error => { console.error(error); process.exitCode = 1; });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => backend.close().then(() => process.exit(0)));
}

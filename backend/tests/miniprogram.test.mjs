import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import vm from 'node:vm';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import { createBackend } from '../server.mjs';
const require = createRequire(import.meta.url);
const waitFor = async predicate => { for (let i = 0; i < 150; i++) { if (predicate()) return; await new Promise(r => setTimeout(r, 10)); } throw Error('Timed out waiting for software chain'); };

test('mini-program Page → real HTTP → TCP device → live net quantity and door-close feedback', async t => {
  let clock = 1000;
  const backend = createBackend({ tcpPort: 0, httpPort: 0, host: '127.0.0.1', sessionFile: null, calibrationFile: null,
    clock: () => clock, configs: { CABINET001: { rawEmpty: 8000000, rawLoaded: 8100000, knownGrams: 1000, bottleGrams: 550 } } });
  const ports = await backend.listen(); t.after(() => backend.close());
  const device = net.connect(ports.tcpPort, '127.0.0.1'); await once(device, 'connect'); device.setNoDelay(true);
  const send = async line => { device.write(line); await new Promise(r => setTimeout(r, 15)); };
  const samples = async grams => { for (let i = 0; i < 6; i++) { clock += 250; await send(`RAW:${8000000 + grams * 100}\n`); } };
  let commands = ''; device.on('data', data => { commands += data; });
  await send('REG:CABINET001\nSTATUS:LOCKED\n'); await samples(5500);
  const storage = new Map(), toasts = [];
  let definition;
  const wx = {
    getStorageSync: key => storage.get(key), setStorageSync: (key, data) => storage.set(key, data),
    showToast: data => toasts.push(data.title), vibrateShort() {}, stopPullDownRefresh() {},
    request(options) {
      const controller = new AbortController();
      const url = new URL(options.url);
      if (options.method === 'GET') for (const [k, v] of Object.entries(options.data || {})) url.searchParams.set(k, v);
      fetch(url, { method: options.method, headers: options.header,
        body: options.method === 'POST' ? JSON.stringify(options.data) : undefined, signal: controller.signal })
        .then(async response => options.success({ statusCode: response.status, data: await response.json() }))
        .catch(() => options.fail?.()).finally(() => options.complete?.());
      return { abort: () => controller.abort() };
    },
  };
  vm.runInNewContext(fs.readFileSync(new URL('../../xcx/pages/unlock/unlock.js', import.meta.url), 'utf8'), {
    Page: page => { definition = page; }, require: () => require('../../xcx/utils/cabinet.js'),
    getApp: () => ({ globalData: { apiBase: `http://127.0.0.1:${ports.httpPort}` } }), wx,
    setInterval: () => 1, clearInterval() {}, console,
  });
  const p = { ...definition, data: structuredClone(definition.data), setData(patch) { Object.assign(this.data, patch); } };
  p.onLoad({ deviceId: 'CABINET001' }); p.onShow();
  await waitFor(() => p.data.online && !p._statusPending);
  assert.equal(p.data.buttonDisabled, false);
  p.unlock(); await waitFor(() => p.data.phase === 'UNLOCKING' && !p.data.unlocking && !p._statusPending);
  assert.match(commands, /OPEN\n/);
  assert.equal(p.data.doorStatusText, '柜门已关上');
  await send('OK\nSTATUS:OPEN\n'); await samples(4400); p.refreshStatus();
  await waitFor(() => p.data.quantityText === '2' && !p._statusPending);
  await samples(4950); p.refreshStatus(); await waitFor(() => p.data.quantityText === '1' && !p._statusPending);
  await send('STATUS:LOCKED\n'); p.refreshStatus();
  await waitFor(() => p.data.phase === 'SETTLING' && !p._statusPending);
  assert.ok(toasts.includes('柜门已关上'));
  p.onHide(); await samples(4950); p.onShow();
  await waitFor(() => p.data.phase === 'COMPLETED' && !p._statusPending);
  assert.equal(p.data.quantityText, '1');
  assert.equal(toasts.filter(text => text === '柜门已关上').length, 1);
  assert.equal(p.data.buttonDisabled, false);
  p.onUnload(); device.destroy();
});

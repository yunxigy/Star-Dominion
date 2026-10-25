// Read-only checks against a running service. No door command is issued.
import assert from 'node:assert/strict';
const base = process.env.API_BASE || `http://127.0.0.1:${process.env.HTTP_PORT || 38080}`;
for (const route of ['/api/health', '/api/devices', '/api/status?deviceId=CABINET001']) {
  const response = await fetch(base + route, { signal: AbortSignal.timeout(5000) });
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.code, 0);
  if (route === '/api/health') assert.equal(data.protocol, 2);
  console.log('PASS', route, JSON.stringify(data));
}

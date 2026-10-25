/** Explicit simulator. Only use on a local test service, never alongside a real cabinet with this ID. */
import net from 'node:net';
const id = process.env.DEVICE_ID || 'DEMO001';
const client = net.connect(Number(process.env.TCP_PORT || 9001), '127.0.0.1');
let grams = 5500, door = 'LOCKED', buffer = '';
let timers = [];
client.on('connect', () => { console.log(`[SIMULATOR] ${id} connected; samples are synthetic`); client.write(`REG:${id}\nSTATUS:LOCKED\n`); });
client.on('data', data => {
  buffer += data;
  while (buffer.includes('\n')) {
    const end = buffer.indexOf('\n'); const line = buffer.slice(0, end).trim(); buffer = buffer.slice(end + 1);
    if (line === 'OPEN' && door === 'LOCKED') {
      client.write('OK\n');
      timers.push(setTimeout(() => { door = 'OPEN'; client.write('STATUS:OPEN\n'); }, 500));
      timers.push(setTimeout(() => { grams -= 1100; }, 2500));
      timers.push(setTimeout(() => { grams += 550; }, 5000));
      timers.push(setTimeout(() => { door = 'LOCKED'; client.write('STATUS:LOCKED\n'); }, 7500));
    }
  }
});
const samples = setInterval(() => { if (!client.destroyed) client.write(`RAW:${8000000 + grams * 100}\n`); }, 250);
const registration = setInterval(() => { if (!client.destroyed) client.write(`REG:${id}\nSTATUS:${door}\n`); }, 10000);
client.on('error', error => console.error('[SIMULATOR]', error.message));
client.on('close', () => { clearInterval(samples); clearInterval(registration); timers.forEach(clearTimeout); });
process.on('SIGINT', () => client.destroy());

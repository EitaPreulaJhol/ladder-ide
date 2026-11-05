import { afterEach, describe, expect, it } from 'vitest';
import net from 'node:net';
import WebSocket from 'ws';
import { decode, encode, startBridge, type Bridge, type MapEntry } from '../src/bridge.ts';

/** Tiny Modbus TCP client for tests. */
class Client {
  private sock: net.Socket;
  private tid = 1;
  private constructor(sock: net.Socket) {
    this.sock = sock;
  }
  static connect(port: number) {
    return new Promise<Client>((resolve, reject) => {
      const s = net.connect(port, '127.0.0.1', () => resolve(new Client(s)));
      s.once('error', reject);
    });
  }
  request(pdu: number[]): Promise<Buffer> {
    const header = Buffer.alloc(7);
    const tid = this.tid++;
    header.writeUInt16BE(tid, 0);
    header.writeUInt16BE(0, 2);
    header.writeUInt16BE(pdu.length + 1, 4);
    header[6] = 1;
    return new Promise((resolve) => {
      this.sock.once('data', (d: Buffer) => {
        expect(d.readUInt16BE(0)).toBe(tid);
        resolve(d.subarray(7));
      });
      this.sock.write(Buffer.concat([header, Buffer.from(pdu)]));
    });
  }
  close() {
    this.sock.destroy();
  }
}

const u16 = (n: number) => [(n >> 8) & 0xff, n & 0xff];

function ide(
  port: number,
  token: string,
): Promise<{ ws: WebSocket; next: () => Promise<Record<string, unknown>> }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const queue: Record<string, unknown>[] = [];
    const waiters: ((m: Record<string, unknown>) => void)[] = [];
    ws.on('message', (raw) => {
      const m = JSON.parse(String(raw));
      if (m.type === 'stats') return;
      const w = waiters.shift();
      if (w) w(m);
      else queue.push(m);
    });
    const next = () =>
      new Promise<Record<string, unknown>>((r) => (queue.length ? r(queue.shift()!) : waiters.push(r)));
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'hello', token }));
      resolve({ ws, next });
    });
    ws.on('error', reject);
  });
}

const MAP: MapEntry[] = [
  { tag: 'START', area: 'coil', address: 0, type: 'BOOL' },
  { tag: 'LAMP', area: 'discrete', address: 0, type: 'BOOL' },
  { tag: 'SP', area: 'holding', address: 10, type: 'REAL' },
  { tag: 'COUNT', area: 'holding', address: 12, type: 'INT' },
  { tag: 'LEVEL', area: 'input', address: 0, type: 'DINT' },
];

let bridge: Bridge | null = null;
afterEach(async () => {
  await bridge?.close();
  bridge = null;
});

describe('register encoding', () => {
  it('round-trips INT, DINT and REAL (high word first)', () => {
    expect(encode('INT', -2)).toEqual([0xfffe]);
    expect(decode('INT', [0xfffe])).toBe(-2);
    expect(encode('DINT', 100000)).toEqual([0x0001, 0x86a0]);
    expect(decode('DINT', [0xffff, 0xffff])).toBe(-1);
    expect(decode('REAL', encode('REAL', 12.5))).toBe(12.5);
  });
});

describe('bridge', () => {
  it('serves tag values over Modbus and forwards HMI writes to the IDE', async () => {
    bridge = await startBridge({ token: 'TESTTOKEN', wsPort: 0, modbusPort: 0 });
    const { ws, next } = await ide(bridge.wsPort, 'TESTTOKEN');
    expect((await next()).type).toBe('welcome');
    ws.send(JSON.stringify({ type: 'map', map: MAP }));
    ws.send(
      JSON.stringify({
        type: 'values',
        values: { START: false, LAMP: true, SP: 42.5, COUNT: -3, LEVEL: 70000 },
      }),
    );
    await new Promise((r) => setTimeout(r, 50));

    const mb = await Client.connect(bridge.modbusPort);
    expect([...(await mb.request([2, ...u16(0), ...u16(1)]))]).toEqual([2, 1, 1]); // LAMP = 1
    const hr = await mb.request([3, ...u16(10), ...u16(3)]);
    const regs = [hr.readUInt16BE(2), hr.readUInt16BE(4), hr.readUInt16BE(6)];
    expect(decode('REAL', regs.slice(0, 2))).toBe(42.5);
    expect(decode('INT', [regs[2]!])).toBe(-3);
    const ir = await mb.request([4, ...u16(0), ...u16(2)]);
    expect(decode('DINT', [ir.readUInt16BE(2), ir.readUInt16BE(4)])).toBe(70000);

    // HMI writes: coil and a REAL setpoint (FC16, two registers).
    expect([...(await mb.request([5, ...u16(0), 0xff, 0x00]))]).toEqual([5, 0, 0, 0xff, 0]);
    expect(await next()).toEqual({ type: 'write', tag: 'START', value: true });
    const [hi, lo] = encode('REAL', 55.25);
    await mb.request([16, ...u16(10), ...u16(2), 4, ...u16(hi!), ...u16(lo!)]);
    expect(await next()).toEqual({ type: 'write', tag: 'SP', value: 55.25 });
    mb.close();
    ws.close();
  });

  it('rejects writes outside the map, read-only areas and unknown functions', async () => {
    bridge = await startBridge({ token: 'T', wsPort: 0, modbusPort: 0 });
    const { ws, next } = await ide(bridge.wsPort, 'T');
    await next();
    ws.send(JSON.stringify({ type: 'map', map: MAP }));
    await new Promise((r) => setTimeout(r, 30));
    const mb = await Client.connect(bridge.modbusPort);
    expect([...(await mb.request([5, ...u16(99), 0xff, 0]))]).toEqual([0x85, 2]); // unmapped coil
    expect([...(await mb.request([6, ...u16(0), 0, 1]))]).toEqual([0x86, 2]); // input register area is read-only
    expect([...(await mb.request([5, ...u16(0), 0x12, 0x34]))]).toEqual([0x85, 3]); // illegal coil value
    expect([...(await mb.request([3, ...u16(0), ...u16(200)]))]).toEqual([0x83, 3]); // too many registers
    expect([...(await mb.request([43, 14, 1, 0, 0]))]).toEqual([0xab, 1]); // unsupported function
    mb.close();
    ws.close();
  });

  it('refuses an IDE connection with the wrong pairing code', async () => {
    bridge = await startBridge({ token: 'RIGHT', wsPort: 0, modbusPort: 0 });
    const { next } = await ide(bridge.wsPort, 'WRONG');
    expect(await next()).toEqual({ type: 'error', code: 'badToken' });
  });

  it('listens only on localhost by default', async () => {
    bridge = await startBridge({ token: 'T', wsPort: 0, modbusPort: 0 });
    const lanIp = Object.values((await import('node:os')).networkInterfaces())
      .flat()
      .find((i) => i && i.family === 'IPv4' && !i.internal)?.address;
    if (!lanIp) return; // no network interface in this environment
    const refused = await new Promise<boolean>((resolve) => {
      const s = net.connect(bridge!.modbusPort, lanIp, () => (s.destroy(), resolve(false)));
      s.once('error', () => resolve(true));
    });
    expect(refused).toBe(true);
  });
});

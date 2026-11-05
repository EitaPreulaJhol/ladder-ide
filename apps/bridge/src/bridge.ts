/**
 * Local bridge: Modbus TCP (real HMI / SCADA) <-> WebSocket (LADDER IDE in the browser).
 *
 * Security model:
 *  - the WebSocket listens on 127.0.0.1 only and requires the pairing token
 *    printed in the terminal (a random web page cannot drive the bridge);
 *  - Modbus listens on 127.0.0.1 unless --lan is given;
 *  - only mapped coils / holding registers accept writes.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';
import { createModbusServer, ProcessImage, type Area, type WriteEvent } from './modbus.ts';

export type TagType = 'BOOL' | 'INT' | 'DINT' | 'REAL';

export interface MapEntry {
  tag: string;
  area: Area;
  address: number;
  type: TagType;
}

export interface BridgeOptions {
  token: string;
  wsPort: number;
  modbusPort: number;
  /** Bind Modbus on all interfaces (other machines on the network can connect). */
  lan?: boolean;
  log?: (msg: string) => void;
}

export interface Bridge {
  wsPort: number;
  modbusPort: number;
  close(): Promise<void>;
}

const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export function newToken(): string {
  return [...randomBytes(8)].map((b) => ALPHABET[b % ALPHABET.length]).join('');
}

const sameToken = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Tag value -> registers (DINT/REAL: high word first). */
export function encode(type: TagType, value: number): number[] {
  if (type === 'INT') return [Math.trunc(value) & 0xffff];
  const b = Buffer.alloc(4);
  if (type === 'REAL') b.writeFloatBE(value);
  else b.writeInt32BE(Math.trunc(value) | 0);
  return [b.readUInt16BE(0), b.readUInt16BE(2)];
}

/** Registers -> tag value. */
export function decode(type: TagType, regs: number[]): number {
  if (type === 'INT') {
    const v = regs[0]! & 0xffff;
    return v > 0x7fff ? v - 0x10000 : v;
  }
  const b = Buffer.alloc(4);
  b.writeUInt16BE(regs[0]! & 0xffff, 0);
  b.writeUInt16BE(regs[1]! & 0xffff, 2);
  return type === 'REAL' ? b.readFloatBE(0) : b.readInt32BE(0);
}

const width = (e: MapEntry) =>
  e.area === 'coil' || e.area === 'discrete' ? 1 : e.type === 'DINT' || e.type === 'REAL' ? 2 : 1;

export async function startBridge(opts: BridgeOptions): Promise<Bridge> {
  const log = opts.log ?? (() => undefined);
  const image = new ProcessImage();
  let map: MapEntry[] = [];
  let client: WebSocket | null = null;

  const applyMap = (entries: MapEntry[]) => {
    map = entries.filter(
      (e) =>
        e &&
        typeof e.tag === 'string' &&
        Number.isInteger(e.address) &&
        e.address >= 0 &&
        e.address < 0x10000,
    );
    image.writable.coil.clear();
    image.writable.holding.clear();
    for (const e of map) {
      if (e.area === 'coil') image.writable.coil.add(e.address);
      if (e.area === 'holding') for (let i = 0; i < width(e); i++) image.writable.holding.add(e.address + i);
    }
  };

  const applyValues = (values: Record<string, number | boolean>) => {
    for (const e of map) {
      const v = values[e.tag];
      if (v === undefined) continue;
      if (e.area === 'coil' || e.area === 'discrete')
        image.bits[e.area].set(e.address, typeof v === 'boolean' ? v : v !== 0);
      else
        encode(e.type, Number(v)).forEach((r, i) =>
          image.regs[e.area as 'holding' | 'input'].set(e.address + i, r),
        );
    }
  };

  const onWrite = (w: WriteEvent) => {
    const touched = map.filter(
      (e) => e.area === w.area && e.address < w.address + w.count && e.address + width(e) > w.address,
    );
    for (const e of touched) {
      const value =
        e.area === 'coil'
          ? (image.bits.coil.get(e.address) ?? false)
          : decode(
              e.type,
              Array.from({ length: width(e) }, (_, i) => image.regs.holding.get(e.address + i) ?? 0),
            );
      client?.send(JSON.stringify({ type: 'write', tag: e.tag, value }));
    }
  };

  let requests = 0;
  const modbus = createModbusServer(image, onWrite, () => requests++);
  await new Promise<void>((resolve, reject) => {
    modbus.once('error', reject);
    modbus.listen(opts.modbusPort, opts.lan ? '0.0.0.0' : '127.0.0.1', () => resolve());
  });
  const modbusPort = (modbus.address() as AddressInfo).port;

  const wss = new WebSocketServer({ host: '127.0.0.1', port: opts.wsPort, maxPayload: 1024 * 1024 });
  await new Promise<void>((resolve, reject) => {
    wss.once('listening', () => resolve());
    wss.once('error', reject);
  });
  const wsPort = (wss.address() as AddressInfo).port;

  const stats = setInterval(() => {
    client?.send(JSON.stringify({ type: 'stats', requests }));
  }, 1000);
  stats.unref();

  wss.on('connection', (ws) => {
    let paired = false;
    const timer = setTimeout(() => ws.close(4001, 'pairing timeout'), 5000);
    ws.on('message', (raw) => {
      let msg: { type?: string; token?: string; map?: MapEntry[]; values?: Record<string, number | boolean> };
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (!paired) {
        if (msg.type !== 'hello' || typeof msg.token !== 'string' || !sameToken(msg.token, opts.token)) {
          ws.send(JSON.stringify({ type: 'error', code: 'badToken' }));
          ws.close(4003, 'bad token');
          return;
        }
        paired = true;
        clearTimeout(timer);
        if (client && client !== ws) client.close(4000, 'replaced');
        client = ws;
        ws.send(JSON.stringify({ type: 'welcome', modbusPort, lan: !!opts.lan }));
        log('IDE conectada.');
        return;
      }
      if (msg.type === 'map' && Array.isArray(msg.map)) applyMap(msg.map);
      else if (msg.type === 'values' && msg.values && typeof msg.values === 'object') applyValues(msg.values);
    });
    ws.on('close', () => {
      clearTimeout(timer);
      if (client === ws) {
        client = null;
        log('IDE desconectada.');
      }
    });
  });

  return {
    wsPort,
    modbusPort,
    async close() {
      clearInterval(stats);
      for (const c of wss.clients) c.terminate();
      await new Promise<void>((r) => wss.close(() => r()));
      await new Promise<void>((r) => modbus.close(() => r()));
    },
  };
}

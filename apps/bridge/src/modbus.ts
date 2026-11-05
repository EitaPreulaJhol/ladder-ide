/**
 * Minimal Modbus TCP server: MBAP framing and function codes 1, 2, 3, 4, 5, 6, 15, 16.
 * Data lives in a ProcessImage; writes are reported through `onWrite`.
 */
import net from 'node:net';

export type Area = 'coil' | 'discrete' | 'holding' | 'input';

export interface WriteEvent {
  area: 'coil' | 'holding';
  address: number;
  count: number;
}

/** Exception codes (Modbus application protocol v1.1b3). */
export const EX = { ILLEGAL_FUNCTION: 1, ILLEGAL_ADDRESS: 2, ILLEGAL_VALUE: 3 } as const;

export class ProcessImage {
  bits: Record<'coil' | 'discrete', Map<number, boolean>> = { coil: new Map(), discrete: new Map() };
  regs: Record<'holding' | 'input', Map<number, number>> = { holding: new Map(), input: new Map() };
  /** Writable addresses (only mapped coils / holding registers accept writes). */
  writable: Record<'coil' | 'holding', Set<number>> = { coil: new Set(), holding: new Set() };
}

class ModbusError extends Error {
  code: number;
  constructor(code: number) {
    super(`modbus exception ${code}`);
    this.code = code;
  }
}

function checkRange(start: number, qty: number, max: number) {
  if (qty < 1 || qty > max) throw new ModbusError(EX.ILLEGAL_VALUE);
  if (start + qty > 0x10000) throw new ModbusError(EX.ILLEGAL_ADDRESS);
}

/** Handles one PDU; returns the response PDU (without MBAP). */
export function handlePdu(pdu: Buffer, image: ProcessImage, onWrite: (w: WriteEvent) => void): Buffer {
  const fc = pdu[0]!;
  try {
    if (pdu.length < 5) throw new ModbusError(EX.ILLEGAL_VALUE);
    const start = pdu.readUInt16BE(1);
    switch (fc) {
      case 1:
      case 2: {
        const qty = pdu.readUInt16BE(3);
        checkRange(start, qty, 2000);
        const src = image.bits[fc === 1 ? 'coil' : 'discrete'];
        const bytes = Buffer.alloc(Math.ceil(qty / 8));
        for (let i = 0; i < qty; i++) if (src.get(start + i)) bytes[i >> 3]! |= 1 << (i & 7);
        return Buffer.concat([Buffer.from([fc, bytes.length]), bytes]);
      }
      case 3:
      case 4: {
        const qty = pdu.readUInt16BE(3);
        checkRange(start, qty, 125);
        const src = image.regs[fc === 3 ? 'holding' : 'input'];
        const out = Buffer.alloc(2 + qty * 2);
        out[0] = fc;
        out[1] = qty * 2;
        for (let i = 0; i < qty; i++) out.writeUInt16BE((src.get(start + i) ?? 0) & 0xffff, 2 + i * 2);
        return out;
      }
      case 5: {
        const v = pdu.readUInt16BE(3);
        if (v !== 0xff00 && v !== 0x0000) throw new ModbusError(EX.ILLEGAL_VALUE);
        if (!image.writable.coil.has(start)) throw new ModbusError(EX.ILLEGAL_ADDRESS);
        image.bits.coil.set(start, v === 0xff00);
        onWrite({ area: 'coil', address: start, count: 1 });
        return Buffer.from(pdu.subarray(0, 5));
      }
      case 6: {
        if (!image.writable.holding.has(start)) throw new ModbusError(EX.ILLEGAL_ADDRESS);
        image.regs.holding.set(start, pdu.readUInt16BE(3));
        onWrite({ area: 'holding', address: start, count: 1 });
        return Buffer.from(pdu.subarray(0, 5));
      }
      case 15: {
        const qty = pdu.readUInt16BE(3);
        checkRange(start, qty, 1968);
        const byteCount = pdu[5]!;
        if (byteCount !== Math.ceil(qty / 8) || pdu.length < 6 + byteCount)
          throw new ModbusError(EX.ILLEGAL_VALUE);
        for (let i = 0; i < qty; i++)
          if (!image.writable.coil.has(start + i)) throw new ModbusError(EX.ILLEGAL_ADDRESS);
        for (let i = 0; i < qty; i++)
          image.bits.coil.set(start + i, ((pdu[6 + (i >> 3)]! >> (i & 7)) & 1) === 1);
        onWrite({ area: 'coil', address: start, count: qty });
        return Buffer.from(pdu.subarray(0, 5));
      }
      case 16: {
        const qty = pdu.readUInt16BE(3);
        checkRange(start, qty, 123);
        const byteCount = pdu[5]!;
        if (byteCount !== qty * 2 || pdu.length < 6 + byteCount) throw new ModbusError(EX.ILLEGAL_VALUE);
        for (let i = 0; i < qty; i++)
          if (!image.writable.holding.has(start + i)) throw new ModbusError(EX.ILLEGAL_ADDRESS);
        for (let i = 0; i < qty; i++) image.regs.holding.set(start + i, pdu.readUInt16BE(6 + i * 2));
        onWrite({ area: 'holding', address: start, count: qty });
        return Buffer.from(pdu.subarray(0, 5));
      }
      default:
        throw new ModbusError(EX.ILLEGAL_FUNCTION);
    }
  } catch (e) {
    if (e instanceof ModbusError) return Buffer.from([fc | 0x80, e.code]);
    throw e;
  }
}

/** TCP server speaking Modbus (MBAP framing, any unit id). */
export function createModbusServer(
  image: ProcessImage,
  onWrite: (w: WriteEvent) => void,
  onRequest?: () => void,
): net.Server {
  return net.createServer((socket) => {
    let buf: Buffer = Buffer.alloc(0);
    socket.setNoDelay(true);
    socket.on('data', (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length >= 7) {
        const len = buf.readUInt16BE(4);
        if (len < 2 || len > 254) {
          socket.destroy(); // not Modbus
          return;
        }
        if (buf.length < 6 + len) break;
        const frame = buf.subarray(0, 6 + len);
        buf = buf.subarray(6 + len);
        if (frame.readUInt16BE(2) !== 0) continue; // protocol id must be 0
        const resp = handlePdu(frame.subarray(7), image, onWrite);
        onRequest?.();
        const header = Buffer.alloc(7);
        header.writeUInt16BE(frame.readUInt16BE(0), 0);
        header.writeUInt16BE(0, 2);
        header.writeUInt16BE(resp.length + 1, 4);
        header[6] = frame[6]!;
        socket.write(Buffer.concat([header, resp]));
      }
    });
    socket.on('error', () => socket.destroy());
  });
}

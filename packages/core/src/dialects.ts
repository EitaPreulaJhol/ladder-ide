/**
 * Dialects only change presentation: instruction mnemonics, member names and
 * address syntax. The program model and the simulator are shared, so a
 * project can be switched between dialects without being modified.
 */
import type { Address, DataType, DialectId, InstructionId } from './model.ts';
import type { Member } from './operand.ts';
import { formatTime } from './operand.ts';

export interface ParsedAddress {
  address: Address;
  type: DataType;
}

export interface Dialect {
  id: DialectId;
  name: string;
  /** Short description of the family of PLCs this dialect resembles. */
  family: string;
  /** `bar` draws contacts as -| |-, `bracket` as -] [- (RSLogix). */
  contactStyle: 'bar' | 'bracket';
  /** How hardware auto-assignment numbers I/O words. */
  ioNumbering: 'sequential' | 'slot';
  mnemonic(instr: InstructionId): string;
  memberName(member: Member, owner: 'TIMER' | 'COUNTER'): string;
  formatAddress(addr: Address, type: DataType): string;
  parseAddress(text: string): ParsedAddress | null;
  formatPreset(ms: number): string;
}

const BASE_MNEMONICS: Record<InstructionId, string> = {
  NO: 'NO',
  NC: 'NC',
  POS: 'P',
  NEG: 'N',
  COIL: 'OUT',
  NCOIL: 'OUT/',
  SET: 'S',
  RESET: 'R',
  TON: 'TON',
  TOF: 'TOF',
  TP: 'TP',
  RTO: 'TONR',
  CTU: 'CTU',
  CTD: 'CTD',
  CTUD: 'CTUD',
  RES: 'RST',
  EQ: 'EQ',
  NE: 'NE',
  GT: 'GT',
  GE: 'GE',
  LT: 'LT',
  LE: 'LE',
  MOVE: 'MOVE',
  ADD: 'ADD',
  SUB: 'SUB',
  MUL: 'MUL',
  DIV: 'DIV',
  MOD: 'MOD',
  SR: 'SR',
  RS: 'RS',
  JMP: 'JMP',
  LBL: 'LBL',
  CALL: 'CALL',
  SCALE: 'SCALE',
  PID: 'PID',
  BSL: 'BSL',
  BSR: 'BSR',
  SHL: 'SHL',
  SHR: 'SHR',
  NORM_X: 'NORM_X',
  SCALE_X: 'SCALE_X',
};

const IEC_MEMBERS: Record<'TIMER' | 'COUNTER', Record<Member, string>> = {
  TIMER: { DN: 'Q', ACC: 'ET', PRE: 'PT', EN: 'IN', TT: 'TT', CU: 'CU', CD: 'CD', QD: 'QD' },
  COUNTER: { DN: 'QU', ACC: 'CV', PRE: 'PV', EN: 'EN', TT: 'TT', CU: 'CU', CD: 'CD', QD: 'QD' },
};

const isBitType = (t: DataType) => t === 'BOOL';
const wordPrefix = (t: DataType) => (t === 'DINT' || t === 'REAL' ? 'D' : 'W');

/** Byte/bit view of a canonical (word, bit 0..15) address. */
function toByteBit(addr: Address): [number, number] {
  const bit = addr.bit ?? 0;
  return [addr.index * 2 + (bit >> 3), bit & 7];
}

function fromByteBit(byte: number, bit: number): { index: number; bit: number } {
  return { index: byte >> 1, bit: (byte & 1) * 8 + bit };
}

// ------------------------------------------------------------------ IEC 61131-3

const iec: Dialect = {
  id: 'iec',
  name: 'IEC 61131-3',
  family: 'CODESYS, Schneider, WEG, Beckhoff…',
  contactStyle: 'bar',
  ioNumbering: 'sequential',
  mnemonic: (i) => BASE_MNEMONICS[i],
  memberName: (m, owner) => IEC_MEMBERS[owner][m],
  formatAddress(addr, type) {
    if (addr.area === 'T' || addr.area === 'C') return '';
    if (isBitType(type)) {
      const [byte, bit] = toByteBit(addr);
      return `%${addr.area}X${byte}.${bit}`;
    }
    return `%${addr.area}${wordPrefix(type)}${addr.index}`;
  },
  parseAddress(text) {
    const s = text.trim().toUpperCase();
    let m = /^%([IQM])X?(\d+)\.([0-7])$/.exec(s);
    if (m)
      return { address: { area: m[1] as Address['area'], ...fromByteBit(+m[2]!, +m[3]!) }, type: 'BOOL' };
    m = /^%([IQM])([WD])(\d+)$/.exec(s);
    if (m)
      return {
        address: { area: m[1] as Address['area'], index: +m[3]! },
        type: m[2] === 'D' ? 'DINT' : 'INT',
      };
    return null;
  },
  formatPreset: formatTime,
};

// ------------------------------------------------------------------ Siemens

const SIEMENS_MNEMONICS: Partial<Record<InstructionId, string>> = {
  NO: '-| |-',
  NC: '-|/|-',
  POS: '-|P|-',
  NEG: '-|N|-',
  COIL: '-( )-',
  NCOIL: '-(/)-',
  SET: '-(S)-',
  RESET: '-(R)-',
  RES: '-(RT)-',
  EQ: 'CMP ==',
  NE: 'CMP <>',
  GT: 'CMP >',
  GE: 'CMP >=',
  LT: 'CMP <',
  LE: 'CMP <=',
  JMP: '-(JMP)-',
  LBL: 'LABEL',
  PID: 'PID_Compact',
};

const siemens: Dialect = {
  id: 'siemens',
  name: 'Siemens (estilo TIA/STEP 7)',
  family: 'S7-1200, S7-1500, S7-300',
  contactStyle: 'bar',
  ioNumbering: 'sequential',
  mnemonic: (i) => SIEMENS_MNEMONICS[i] ?? BASE_MNEMONICS[i],
  memberName: (m, owner) => IEC_MEMBERS[owner][m],
  formatAddress(addr, type) {
    if (addr.area === 'T' || addr.area === 'C') return `${addr.area}${addr.index}`;
    if (isBitType(type)) {
      const [byte, bit] = toByteBit(addr);
      return `${addr.area}${byte}.${bit}`;
    }
    return `${addr.area}${wordPrefix(type)}${addr.index * 2}`;
  },
  parseAddress(text) {
    const s = text.trim().toUpperCase();
    let m = /^([IQM])(\d+)\.([0-7])$/.exec(s);
    if (m)
      return { address: { area: m[1] as Address['area'], ...fromByteBit(+m[2]!, +m[3]!) }, type: 'BOOL' };
    m = /^([IQM])([WD])(\d+)$/.exec(s);
    if (m && +m[3]! % 2 === 0)
      return {
        address: { area: m[1] as Address['area'], index: +m[3]! / 2 },
        type: m[2] === 'D' ? 'DINT' : 'INT',
      };
    m = /^([TC])(\d+)$/.exec(s);
    if (m)
      return {
        address: { area: m[1] as 'T' | 'C', index: +m[2]! },
        type: m[1] === 'T' ? 'TIMER' : 'COUNTER',
      };
    return null;
  },
  formatPreset: formatTime,
};

// ------------------------------------------------------------------ Allen-Bradley

const AB_MNEMONICS: Partial<Record<InstructionId, string>> = {
  NO: 'XIC',
  NC: 'XIO',
  POS: 'XIC↑',
  NEG: 'XIC↓',
  COIL: 'OTE',
  NCOIL: 'OTE/',
  SET: 'OTL',
  RESET: 'OTU',
  RTO: 'RTO',
  RES: 'RES',
  EQ: 'EQU',
  NE: 'NEQ',
  GT: 'GRT',
  GE: 'GEQ',
  LT: 'LES',
  LE: 'LEQ',
  MOVE: 'MOV',
  CALL: 'JSR',
  SCALE: 'SCP',
};

const AB_MEMBERS: Record<Member, string> = {
  DN: 'DN',
  ACC: 'ACC',
  PRE: 'PRE',
  EN: 'EN',
  TT: 'TT',
  CU: 'CU',
  CD: 'CD',
  QD: 'QD',
};

const AB_WORD_FILES: Record<string, { type: DataType; file: string }> = {
  INT: { type: 'INT', file: 'N7' },
  DINT: { type: 'DINT', file: 'L9' },
  REAL: { type: 'REAL', file: 'F8' },
};

const ab: Dialect = {
  id: 'ab',
  name: 'Allen-Bradley (estilo RSLogix)',
  family: 'SLC 500, MicroLogix, CompactLogix',
  contactStyle: 'bracket',
  ioNumbering: 'slot',
  mnemonic: (i) => AB_MNEMONICS[i] ?? BASE_MNEMONICS[i],
  memberName: (m) => AB_MEMBERS[m],
  formatAddress(addr, type) {
    switch (addr.area) {
      case 'T':
        return `T4:${addr.index}`;
      case 'C':
        return `C5:${addr.index}`;
      case 'I':
      case 'Q': {
        const p = addr.area === 'I' ? 'I' : 'O';
        return isBitType(type) ? `${p}:${addr.index}/${addr.bit ?? 0}` : `${p}:${addr.index}`;
      }
      case 'M':
        if (isBitType(type)) return `B3:${addr.index}/${addr.bit ?? 0}`;
        return `${(AB_WORD_FILES[type] ?? AB_WORD_FILES.INT)!.file}:${addr.index}`;
    }
  },
  parseAddress(text) {
    const s = text.trim().toUpperCase();
    let m = /^([IO]):(\d+)\/(\d+)$/.exec(s);
    if (m && +m[3]! < 16)
      return { address: { area: m[1] === 'I' ? 'I' : 'Q', index: +m[2]!, bit: +m[3]! }, type: 'BOOL' };
    m = /^([IO]):(\d+)(?:\.0)?$/.exec(s);
    if (m) return { address: { area: m[1] === 'I' ? 'I' : 'Q', index: +m[2]! }, type: 'INT' };
    m = /^B3:(\d+)\/(\d+)$/.exec(s);
    if (m && +m[2]! < 16) return { address: { area: 'M', index: +m[1]!, bit: +m[2]! }, type: 'BOOL' };
    m = /^(N7|L9|F8):(\d+)$/.exec(s);
    if (m) {
      const type: DataType = m[1] === 'N7' ? 'INT' : m[1] === 'L9' ? 'DINT' : 'REAL';
      return { address: { area: 'M', index: +m[2]! }, type };
    }
    m = /^(T4|C5):(\d+)$/.exec(s);
    if (m)
      return {
        address: { area: m[1] === 'T4' ? 'T' : 'C', index: +m[2]! },
        type: m[1] === 'T4' ? 'TIMER' : 'COUNTER',
      };
    return null;
  },
  formatPreset: (ms) => String(ms),
};

// ------------------------------------------------------------------ Schneider (Machine Expert - Basic / M221)

const SCHNEIDER_MNEMONICS: Partial<Record<InstructionId, string>> = {
  NO: '-| |-',
  NC: '-|/|-',
  POS: '-|P|-',
  NEG: '-|N|-',
  COIL: '-( )-',
  NCOIL: '-(/)-',
  SET: '-(S)-',
  RESET: '-(R)-',
  RES: 'R',
  EQ: '[=]',
  NE: '[<>]',
  GT: '[>]',
  GE: '[>=]',
  LT: '[<]',
  LE: '[<=]',
  MOVE: '[:=]',
  ADD: '[+]',
  SUB: '[-]',
  MUL: '[*]',
  DIV: '[/]',
  MOD: '[REM]',
};

const SCHNEIDER_MEMBERS: Record<'TIMER' | 'COUNTER', Record<Member, string>> = {
  TIMER: { DN: 'Q', ACC: 'V', PRE: 'P', EN: 'IN', TT: 'TT', CU: 'CU', CD: 'CD', QD: 'QD' },
  COUNTER: { DN: 'D', ACC: 'V', PRE: 'P', EN: 'EN', TT: 'TT', CU: 'CU', CD: 'CD', QD: 'E' },
};

const bitNumber = (addr: Address) => addr.index * 16 + (addr.bit ?? 0);
const fromBitNumber = (n: number) => ({ index: n >> 4, bit: n & 15 });

const schneider: Dialect = {
  id: 'schneider',
  name: 'Schneider (estilo Machine Expert Basic)',
  family: 'Modicon M221, M241',
  contactStyle: 'bar',
  ioNumbering: 'slot',
  mnemonic: (i) => SCHNEIDER_MNEMONICS[i] ?? BASE_MNEMONICS[i],
  memberName: (m, owner) => SCHNEIDER_MEMBERS[owner][m],
  formatAddress(addr, type) {
    if (addr.area === 'T') return `%TM${addr.index}`;
    if (addr.area === 'C') return `%C${addr.index}`;
    if (addr.area === 'M') {
      if (isBitType(type)) return `%M${bitNumber(addr)}`;
      return `%M${type === 'REAL' ? 'F' : type === 'DINT' ? 'D' : 'W'}${addr.index}`;
    }
    return isBitType(type) ? `%${addr.area}${addr.index}.${addr.bit ?? 0}` : `%${addr.area}W${addr.index}.0`;
  },
  parseAddress(text) {
    const s = text.trim().toUpperCase();
    let m = /^%([IQ])(\d+)\.(\d+)$/.exec(s);
    if (m && +m[3]! < 16)
      return { address: { area: m[1] as 'I' | 'Q', index: +m[2]!, bit: +m[3]! }, type: 'BOOL' };
    m = /^%M(\d+)$/.exec(s);
    if (m) return { address: { area: 'M', ...fromBitNumber(+m[1]!) }, type: 'BOOL' };
    m = /^%M([WDF])(\d+)$/.exec(s);
    if (m)
      return {
        address: { area: 'M', index: +m[2]! },
        type: m[1] === 'W' ? 'INT' : m[1] === 'D' ? 'DINT' : 'REAL',
      };
    m = /^%(TM|C)(\d+)$/.exec(s);
    if (m)
      return {
        address: { area: m[1] === 'TM' ? 'T' : 'C', index: +m[2]! },
        type: m[1] === 'TM' ? 'TIMER' : 'COUNTER',
      };
    return null;
  },
  formatPreset: formatTime,
};

// ------------------------------------------------------------------ Haiwell (HaiwellHappy)

const HAIWELL_MNEMONICS: Partial<Record<InstructionId, string>> = {
  COIL: 'OUT',
  NCOIL: 'OUT/',
  SET: 'SET',
  RESET: 'RST',
  RES: 'RST',
  EQ: 'CMP =',
  NE: 'CMP <>',
  GT: 'CMP >',
  GE: 'CMP >=',
  LT: 'CMP <',
  LE: 'CMP <=',
  MOVE: 'MOV',
};

const haiwell: Dialect = {
  id: 'haiwell',
  name: 'Haiwell (estilo HaiwellHappy)',
  family: 'Haiwell séries C, T, H',
  contactStyle: 'bar',
  ioNumbering: 'sequential',
  mnemonic: (i) => HAIWELL_MNEMONICS[i] ?? BASE_MNEMONICS[i],
  memberName: (m, owner) => IEC_MEMBERS[owner][m],
  formatAddress(addr, type) {
    switch (addr.area) {
      case 'T':
        return `T${addr.index}`;
      case 'C':
        return `C${addr.index}`;
      case 'I':
        return isBitType(type) ? `X${bitNumber(addr)}` : `AI${addr.index}`;
      case 'Q':
        return isBitType(type) ? `Y${bitNumber(addr)}` : `AQ${addr.index}`;
      case 'M':
        return isBitType(type) ? `M${bitNumber(addr)}` : `V${addr.index}`;
    }
  },
  parseAddress(text) {
    const s = text.trim().toUpperCase();
    let m = /^([XYM])(\d+)$/.exec(s);
    if (m) {
      const area = m[1] === 'X' ? 'I' : m[1] === 'Y' ? 'Q' : 'M';
      return { address: { area, ...fromBitNumber(+m[2]!) }, type: 'BOOL' };
    }
    m = /^(AI|AQ|V)(\d+)$/.exec(s);
    if (m)
      return {
        address: { area: m[1] === 'AI' ? 'I' : m[1] === 'AQ' ? 'Q' : 'M', index: +m[2]! },
        type: 'INT',
      };
    m = /^([TC])(\d+)$/.exec(s);
    if (m)
      return {
        address: { area: m[1] as 'T' | 'C', index: +m[2]! },
        type: m[1] === 'T' ? 'TIMER' : 'COUNTER',
      };
    return null;
  },
  formatPreset: formatTime,
};

export const DIALECTS: Record<DialectId, Dialect> = { iec, ab, siemens, schneider, haiwell };
export const DIALECT_IDS: DialectId[] = ['iec', 'siemens', 'ab', 'schneider', 'haiwell'];

export function getDialect(id: DialectId): Dialect {
  return DIALECTS[id] ?? iec;
}

import type { DataType, InstructionId } from './model.ts';

export type InstructionCategory = 'contact' | 'coil' | 'timer' | 'counter' | 'compare' | 'math';

/** What an operand slot accepts. */
export type OperandKind =
  | 'bit' // BOOL tag or a timer/counter status bit (T1.DN)
  | 'timer'
  | 'counter'
  | 'timerOrCounter'
  | 'time' // preset in ms: literal (5000, T#5s) or numeric tag
  | 'number' // numeric tag or literal
  | 'numberDest'; // numeric tag that will be written

export interface OperandSpec {
  kind: OperandKind;
  /** i18n key suffix for the operand label (`operand.<label>`). */
  label: string;
}

export interface InstructionInfo {
  id: InstructionId;
  category: InstructionCategory;
  operands: OperandSpec[];
  /** Output instructions terminate a branch in strict dialects (Allen-Bradley). */
  isOutput: boolean;
  /** Box-shaped (drawn as a block) rather than a contact/coil symbol. */
  isBox: boolean;
}

const op = (kind: OperandKind, label: string): OperandSpec => ({ kind, label });

const list: InstructionInfo[] = [
  { id: 'NO', category: 'contact', operands: [op('bit', 'bit')], isOutput: false, isBox: false },
  { id: 'NC', category: 'contact', operands: [op('bit', 'bit')], isOutput: false, isBox: false },
  { id: 'POS', category: 'contact', operands: [op('bit', 'bit')], isOutput: false, isBox: false },
  { id: 'NEG', category: 'contact', operands: [op('bit', 'bit')], isOutput: false, isBox: false },

  { id: 'COIL', category: 'coil', operands: [op('bit', 'bit')], isOutput: true, isBox: false },
  { id: 'NCOIL', category: 'coil', operands: [op('bit', 'bit')], isOutput: true, isBox: false },
  { id: 'SET', category: 'coil', operands: [op('bit', 'bit')], isOutput: true, isBox: false },
  { id: 'RESET', category: 'coil', operands: [op('bit', 'bit')], isOutput: true, isBox: false },

  {
    id: 'TON',
    category: 'timer',
    operands: [op('timer', 'timer'), op('time', 'preset')],
    isOutput: true,
    isBox: true,
  },
  {
    id: 'TOF',
    category: 'timer',
    operands: [op('timer', 'timer'), op('time', 'preset')],
    isOutput: true,
    isBox: true,
  },
  {
    id: 'TP',
    category: 'timer',
    operands: [op('timer', 'timer'), op('time', 'preset')],
    isOutput: true,
    isBox: true,
  },
  {
    id: 'RTO',
    category: 'timer',
    operands: [op('timer', 'timer'), op('time', 'preset')],
    isOutput: true,
    isBox: true,
  },

  {
    id: 'CTU',
    category: 'counter',
    operands: [op('counter', 'counter'), op('number', 'preset')],
    isOutput: true,
    isBox: true,
  },
  {
    id: 'CTD',
    category: 'counter',
    operands: [op('counter', 'counter'), op('number', 'preset')],
    isOutput: true,
    isBox: true,
  },
  {
    id: 'CTUD',
    category: 'counter',
    operands: [op('counter', 'counter'), op('number', 'preset'), op('bit', 'countDown')],
    isOutput: true,
    isBox: true,
  },
  {
    id: 'RES',
    category: 'counter',
    operands: [op('timerOrCounter', 'target')],
    isOutput: true,
    isBox: false,
  },

  {
    id: 'EQ',
    category: 'compare',
    operands: [op('number', 'a'), op('number', 'b')],
    isOutput: false,
    isBox: true,
  },
  {
    id: 'NE',
    category: 'compare',
    operands: [op('number', 'a'), op('number', 'b')],
    isOutput: false,
    isBox: true,
  },
  {
    id: 'GT',
    category: 'compare',
    operands: [op('number', 'a'), op('number', 'b')],
    isOutput: false,
    isBox: true,
  },
  {
    id: 'GE',
    category: 'compare',
    operands: [op('number', 'a'), op('number', 'b')],
    isOutput: false,
    isBox: true,
  },
  {
    id: 'LT',
    category: 'compare',
    operands: [op('number', 'a'), op('number', 'b')],
    isOutput: false,
    isBox: true,
  },
  {
    id: 'LE',
    category: 'compare',
    operands: [op('number', 'a'), op('number', 'b')],
    isOutput: false,
    isBox: true,
  },

  {
    id: 'MOVE',
    category: 'math',
    operands: [op('number', 'source'), op('numberDest', 'dest')],
    isOutput: true,
    isBox: true,
  },
  ...(['ADD', 'SUB', 'MUL', 'DIV', 'MOD'] as const).map((id): InstructionInfo => ({
    id,
    category: 'math',
    operands: [op('number', 'a'), op('number', 'b'), op('numberDest', 'dest')],
    isOutput: true,
    isBox: true,
  })),
];

export const INSTRUCTIONS: Record<InstructionId, InstructionInfo> = Object.fromEntries(
  list.map((i) => [i.id, i]),
) as Record<InstructionId, InstructionInfo>;

export const INSTRUCTION_IDS = list.map((i) => i.id);

export const CATEGORY_ORDER: InstructionCategory[] = [
  'contact',
  'coil',
  'timer',
  'counter',
  'compare',
  'math',
];

/** Default tag type created when an operand of this kind references an unknown tag. */
export function defaultTypeForOperand(kind: OperandKind): DataType | null {
  switch (kind) {
    case 'bit':
      return 'BOOL';
    case 'timer':
      return 'TIMER';
    case 'counter':
      return 'COUNTER';
    case 'number':
    case 'numberDest':
    case 'time':
      return 'INT';
    default:
      return null;
  }
}

/** Default operands for a freshly inserted instruction. */
export function defaultOperands(id: InstructionId): string[] {
  const info = INSTRUCTIONS[id];
  return info.operands.map((o) => {
    if (o.kind === 'time') return 'T#5s';
    if (o.label === 'preset') return '10';
    if (o.label === 'b') return '0';
    return '';
  });
}

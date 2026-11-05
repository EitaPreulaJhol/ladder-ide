import {
  getDialect,
  parseOperand,
  readOperandValue,
  tagAddress,
  type Element,
  type Project,
  type Tag,
  type Value,
} from '@ladder/core';

export const CW = 112;
export const CH = 84;
export const WY = 46;
export const PAD = 16;

/** Operand shown in the current dialect (member aliases, time literals). */
export function displayOperand(text: string | undefined, project: Project, kind?: string): string {
  const s = (text ?? '').trim();
  if (!s) return '???';
  const p = parseOperand(s);
  const d = getDialect(project.dialect);
  if (p.kind === 'tag' && p.member) {
    const tag = project.tags.find((t) => t.name === p.name);
    const owner = tag?.type === 'COUNTER' ? 'COUNTER' : 'TIMER';
    return `${p.name}.${d.memberName(p.member, owner)}`;
  }
  if (p.kind === 'literal' && kind === 'time') return d.formatPreset(p.value);
  return s;
}

export function tagOf(project: Project, operand: string | undefined): Tag | undefined {
  const p = parseOperand(operand);
  return p.kind === 'tag' ? project.tags.find((t) => t.name === p.name) : undefined;
}

export function addressOf(project: Project, operand: string | undefined): string {
  const t = tagOf(project, operand);
  return t ? tagAddress(t, project) : '';
}

/** Live value of an operand (tag, member or literal) from a snapshot. */
/** Live value of an operand (tag, member, word bit or literal) from a snapshot. */
export function liveValue(
  values: Record<string, Value> | undefined,
  operand: string | undefined,
): number | boolean | undefined {
  if (!values) {
    const p = parseOperand(operand);
    return p.kind === 'literal' ? p.value : undefined;
  }
  return readOperandValue(values, operand);
}

export function formatValue(v: Value | undefined): string {
  if (v === undefined) return '';
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
  return `${v.acc}/${v.pre}`;
}

export function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)}s`;
  const m = Math.floor(ms / 60_000);
  return `${m}m${Math.floor((ms % 60_000) / 1000)}s`;
}

export const isElementBitOn = (
  el: Element,
  values: Record<string, Value> | undefined,
): boolean | undefined => {
  const v = liveValue(values, el.operands[0]);
  return v === undefined ? undefined : typeof v === 'boolean' ? v : v !== 0;
};

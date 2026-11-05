/** Small builder DSL used by examples, scenario solutions and tests. */
import type { DataType, InstructionId, LadderNode, Parallel, Program, Rung, Series, Tag } from './model.ts';
import { createElement } from './edit.ts';
import { newId } from './ids.ts';

export const el = (instr: InstructionId, ...operands: string[]) => createElement(instr, operands);
export const no = (t: string) => el('NO', t);
export const nc = (t: string) => el('NC', t);
export const coil = (t: string) => el('COIL', t);
export const set = (t: string) => el('SET', t);
export const reset = (t: string) => el('RESET', t);
export const par = (...branches: Series[]): Parallel => ({ kind: 'par', id: newId('p_'), branches });
export const rung = (body: LadderNode[], comment?: string): Rung => ({
  id: newId('r_'),
  body,
  ...(comment ? { comment } : {}),
});
export const program = (name: string, rungs: Rung[]): Program => ({ id: newId('g_'), name, rungs });
export const tag = (name: string, type: DataType, extra: Partial<Tag> = {}): Tag => ({
  name,
  type,
  ...extra,
});

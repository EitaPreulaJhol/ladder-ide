import { describe, expect, it } from 'vitest';
import { formatTime, parseOperand, parseTime } from '../src/index.ts';

describe('operands', () => {
  it('parses time literals', () => {
    expect(parseTime('T#5s')).toBe(5000);
    expect(parseTime('T#1m30s')).toBe(90_000);
    expect(parseTime('TIME#250ms')).toBe(250);
    expect(parseTime('1.5s')).toBe(1500);
    expect(parseTime('T#1h2m3s4ms')).toBe(3_723_004);
    expect(parseTime('T#5x')).toBeNull();
    expect(parseTime('500')).toBeNull();
    expect(formatTime(90_500)).toBe('T#1m30s500ms');
  });

  it('parses tags, members and literals', () => {
    expect(parseOperand('Motor')).toEqual({ kind: 'tag', name: 'Motor' });
    expect(parseOperand('T1.Q')).toEqual({ kind: 'tag', name: 'T1', member: 'DN' });
    expect(parseOperand('T1.et')).toEqual({ kind: 'tag', name: 'T1', member: 'ACC' });
    expect(parseOperand('C1.CV')).toEqual({ kind: 'tag', name: 'C1', member: 'ACC' });
    expect(parseOperand('-12.5')).toEqual({ kind: 'literal', value: -12.5 });
    expect(parseOperand('16#FF')).toEqual({ kind: 'literal', value: 255 });
    expect(parseOperand('2#1010')).toEqual({ kind: 'literal', value: 10 });
    expect(parseOperand('T#2s')).toEqual({ kind: 'literal', value: 2000 });
    expect(parseOperand('')).toEqual({ kind: 'empty' });
    expect(parseOperand('T1.XYZ').kind).toBe('invalid');
    expect(parseOperand('1abc').kind).toBe('invalid');
  });
});

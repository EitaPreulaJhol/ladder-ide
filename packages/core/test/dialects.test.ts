import { describe, expect, it } from 'vitest';
import { DIALECTS, type Address, type DataType } from '../src/index.ts';

const cases: [Address, DataType, Record<string, string>][] = [
  [{ area: 'I', index: 0, bit: 0 }, 'BOOL', { iec: '%IX0.0', siemens: 'I0.0', ab: 'I:0/0' }],
  [{ area: 'I', index: 0, bit: 9 }, 'BOOL', { iec: '%IX1.1', siemens: 'I1.1', ab: 'I:0/9' }],
  [{ area: 'Q', index: 2, bit: 3 }, 'BOOL', { iec: '%QX4.3', siemens: 'Q4.3', ab: 'O:2/3' }],
  [{ area: 'M', index: 1, bit: 15 }, 'BOOL', { iec: '%MX3.7', siemens: 'M3.7', ab: 'B3:1/15' }],
  [{ area: 'M', index: 5 }, 'INT', { iec: '%MW5', siemens: 'MW10', ab: 'N7:5' }],
  [{ area: 'M', index: 4 }, 'DINT', { iec: '%MD4', siemens: 'MD8', ab: 'L9:4' }],
  [{ area: 'T', index: 3 }, 'TIMER', { siemens: 'T3', ab: 'T4:3' }],
  [{ area: 'C', index: 1 }, 'COUNTER', { siemens: 'C1', ab: 'C5:1' }],
];

describe('dialect addresses', () => {
  for (const [addr, type, expected] of cases) {
    for (const [id, text] of Object.entries(expected)) {
      it(`${id}: ${text} round-trips`, () => {
        const d = DIALECTS[id as keyof typeof DIALECTS];
        expect(d.formatAddress(addr, type)).toBe(text);
        const parsed = d.parseAddress(text);
        expect(parsed?.address).toEqual(addr);
        expect(parsed?.type).toBe(type);
      });
    }
  }

  it('rejects invalid addresses', () => {
    expect(DIALECTS.siemens.parseAddress('I0.8')).toBeNull();
    expect(DIALECTS.siemens.parseAddress('MW3')).toBeNull();
    expect(DIALECTS.ab.parseAddress('I:0/16')).toBeNull();
    expect(DIALECTS.iec.parseAddress('Motor')).toBeNull();
  });

  it('mnemonics differ per dialect', () => {
    expect(DIALECTS.ab.mnemonic('NO')).toBe('XIC');
    expect(DIALECTS.ab.mnemonic('SET')).toBe('OTL');
    expect(DIALECTS.siemens.mnemonic('SET')).toBe('-(S)-');
    expect(DIALECTS.iec.mnemonic('RTO')).toBe('TONR');
    expect(DIALECTS.iec.memberName('DN', 'TIMER')).toBe('Q');
    expect(DIALECTS.ab.memberName('ACC', 'TIMER')).toBe('ACC');
  });
});

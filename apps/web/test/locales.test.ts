import { describe, expect, it } from 'vitest';
import ptBR from '../src/locales/pt-BR.json';
import en from '../src/locales/en.json';
import es from '../src/locales/es.json';

type Tree = { [k: string]: string | Tree };

function flatten(t: Tree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(t)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out[key] = v;
    else Object.assign(out, flatten(v, key));
  }
  return out;
}

const placeholders = (s: string) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();

const base = flatten(ptBR as Tree);
const others: [string, Record<string, string>][] = [
  ['en', flatten(en as Tree)],
  ['es', flatten(es as Tree)],
];

describe('locales', () => {
  for (const [name, loc] of others) {
    it(`${name} has exactly the same keys as pt-BR`, () => {
      expect(Object.keys(loc).sort()).toEqual(Object.keys(base).sort());
    });
    it(`${name} keeps every {{placeholder}}`, () => {
      const wrong = Object.keys(base).filter(
        (k) => loc[k] !== undefined && placeholders(loc[k]!).join() !== placeholders(base[k]!).join(),
      );
      expect(wrong).toEqual([]);
    });
    it(`${name} has no empty strings`, () => {
      expect(
        Object.entries(loc)
          .filter(([, v]) => !v.trim())
          .map(([k]) => k),
      ).toEqual([]);
    });
  }
});

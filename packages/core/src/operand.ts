/** Parsing of operand strings: tag references, member access and literals. */

export type Member = 'DN' | 'ACC' | 'PRE' | 'EN' | 'TT' | 'CU' | 'CD' | 'QD';

export const MEMBERS: Member[] = ['DN', 'ACC', 'PRE', 'EN', 'TT', 'CU', 'CD', 'QD'];

/** Aliases accepted in every dialect (IEC / Siemens / Allen-Bradley names). */
const MEMBER_ALIASES: Record<string, Member> = {
  DN: 'DN',
  Q: 'DN',
  QU: 'DN',
  ACC: 'ACC',
  ET: 'ACC',
  CV: 'ACC',
  PRE: 'PRE',
  PT: 'PRE',
  PV: 'PRE',
  EN: 'EN',
  IN: 'EN',
  TT: 'TT',
  CU: 'CU',
  CD: 'CD',
  QD: 'QD',
  // Schneider Machine Expert Basic: %TMi.V / .P, %Ci.V / .P / .D (done) / .E (empty)
  V: 'ACC',
  P: 'PRE',
  D: 'DN',
  E: 'QD',
};

export const NUMERIC_MEMBERS: ReadonlySet<Member> = new Set(['ACC', 'PRE']);

export type ParsedOperand =
  | { kind: 'empty' }
  | { kind: 'literal'; value: number }
  | { kind: 'tag'; name: string; member?: Member }
  | { kind: 'invalid'; text: string };

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function isValidTagName(name: string): boolean {
  return IDENT.test(name);
}

/**
 * Parses an IEC time literal or a plain duration and returns milliseconds.
 * Accepts `T#5s`, `TIME#1m30s`, `T#250ms`, `5s`, `1.5s`, `500ms`, `2m`, `1h`.
 */
export function parseTime(text: string): number | null {
  let s = text.trim().toLowerCase();
  if (s.startsWith('time#')) s = s.slice(5);
  else if (s.startsWith('t#')) s = s.slice(2);
  else if (!/[a-z]$/.test(s)) return null;
  s = s.replace(/_/g, '');
  if (!s) return null;
  const re = /(\d+(?:\.\d+)?)(ms|h|m|s|d)/g;
  let total = 0;
  let consumed = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index !== consumed) return null;
    consumed = m.index + m[0].length;
    const n = parseFloat(m[1]!);
    const unit = m[2];
    total +=
      n *
      (unit === 'ms'
        ? 1
        : unit === 's'
          ? 1000
          : unit === 'm'
            ? 60_000
            : unit === 'h'
              ? 3_600_000
              : 86_400_000);
  }
  if (consumed !== s.length) return null;
  return Math.round(total);
}

/** Formats milliseconds as an IEC time literal (`T#1m30s`). */
export function formatTime(ms: number): string {
  if (ms === 0) return 'T#0ms';
  let rest = Math.round(ms);
  const parts: string[] = [];
  const units: [string, number][] = [
    ['h', 3_600_000],
    ['m', 60_000],
    ['s', 1000],
    ['ms', 1],
  ];
  for (const [u, size] of units) {
    if (rest >= size) {
      const n = Math.floor(rest / size);
      rest -= n * size;
      parts.push(`${n}${u}`);
    }
  }
  return `T#${parts.join('')}`;
}

export function parseOperand(text: string | undefined): ParsedOperand {
  const s = (text ?? '').trim();
  if (!s) return { kind: 'empty' };
  if (/^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(s)) return { kind: 'literal', value: Number(s) };
  if (/^(16#|0x)[0-9a-f_]+$/i.test(s))
    return { kind: 'literal', value: parseInt(s.replace(/^(16#|0x)/i, '').replace(/_/g, ''), 16) };
  if (/^2#[01_]+$/.test(s)) return { kind: 'literal', value: parseInt(s.slice(2).replace(/_/g, ''), 2) };
  if (/^(true|false)$/i.test(s)) return { kind: 'literal', value: /^true$/i.test(s) ? 1 : 0 };
  const time = parseTime(s);
  if (time !== null) return { kind: 'literal', value: time };
  const dot = s.indexOf('.');
  if (dot < 0) return IDENT.test(s) ? { kind: 'tag', name: s } : { kind: 'invalid', text: s };
  const name = s.slice(0, dot);
  const memberText = s.slice(dot + 1).toUpperCase();
  const member = MEMBER_ALIASES[memberText];
  if (!IDENT.test(name) || !member) return { kind: 'invalid', text: s };
  return { kind: 'tag', name, member };
}

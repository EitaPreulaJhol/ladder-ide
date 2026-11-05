import type { Element, Project, Value } from '@ladder/core';
import { getDialect, INSTRUCTIONS } from '@ladder/core';
import {
  addressOf,
  CH,
  CW,
  displayOperand,
  formatMs,
  formatValue,
  isElementBitOn,
  liveValue,
  WY,
} from './format.ts';

interface Props {
  el: Element;
  project: Project;
  power?: [boolean, boolean];
  values?: Record<string, Value>;
}

const cls = (on: boolean | undefined) => (on ? 'w on' : 'w');

/** Draws one instruction inside a CW × CH cell, including its wire stubs. */
export function Glyph({ el, project, power, values }: Props) {
  const info = INSTRUCTIONS[el.instr];
  const d = getDialect(project.dialect);
  const pin = power?.[0];
  const pout = power?.[1];
  const mid = CW / 2;
  const name = displayOperand(el.operands[0], project);
  const addr = addressOf(project, el.operands[0]);

  if (!info.isBox) {
    const bit = isElementBitOn(el, values);
    const isContact = info.category === 'contact';
    const half = 13;
    const symbol = isContact ? (
      d.contactStyle === 'bracket' ? (
        <>
          <path className={cls(pout)} d={`M${mid - 9} ${WY - half}h-5v${half * 2}h5`} />
          <path className={cls(pout)} d={`M${mid + 9} ${WY - half}h5v${half * 2}h-5`} />
        </>
      ) : (
        <>
          <line className={cls(pout)} x1={mid - 10} y1={WY - half} x2={mid - 10} y2={WY + half} />
          <line className={cls(pout)} x1={mid + 10} y1={WY - half} x2={mid + 10} y2={WY + half} />
        </>
      )
    ) : (
      <>
        <path className={cls(pout)} d={`M${mid - 8} ${WY - 13} a 16 16 0 0 0 0 26`} fill="none" />
        <path className={cls(pout)} d={`M${mid + 8} ${WY - 13} a 16 16 0 0 1 0 26`} fill="none" />
      </>
    );
    const letters: Partial<Record<Element['instr'], string>> = {
      POS: 'P',
      NEG: 'N',
      SET: d.id === 'ab' ? 'L' : 'S',
      RESET: d.id === 'ab' ? 'U' : 'R',
      RES: d.id === 'siemens' ? 'RT' : 'RES',
    };
    const letter = letters[el.instr];
    const inner =
      el.instr === 'NC' || el.instr === 'NCOIL' ? (
        <line className={cls(pout)} x1={mid - 7} y1={WY + 10} x2={mid + 7} y2={WY - 10} />
      ) : letter ? (
        <text
          className={letter.length > 1 ? 'glyph-letter small' : 'glyph-letter'}
          x={mid}
          y={WY + 4}
          textAnchor="middle"
        >
          {letter}
        </text>
      ) : null;
    const gap = isContact ? (d.contactStyle === 'bracket' ? 14 : 10) : 14;
    return (
      <svg width={CW} height={CH} className="glyph">
        {bit !== undefined && (
          <rect
            className={bit ? 'bitfill on' : 'bitfill'}
            x={mid - gap + 1}
            y={WY - 12}
            width={(gap - 1) * 2}
            height={24}
            rx={isContact ? 1 : 10}
          />
        )}
        <line className={cls(pin)} x1={0} y1={WY} x2={mid - gap} y2={WY} />
        <line className={cls(pout)} x1={mid + gap} y1={WY} x2={CW} y2={WY} />
        {symbol}
        {inner}
        {d.id === 'ab' && (
          <text className="glyph-mnemonic" x={mid} y={WY + 26} textAnchor="middle">
            {d.mnemonic(el.instr)}
          </text>
        )}
        <text
          className={name === '???' ? 'glyph-name missing' : 'glyph-name'}
          x={mid}
          y={16}
          textAnchor="middle"
        >
          {truncate(name, 15)}
        </text>
        {addr && (
          <text className="glyph-addr" x={mid} y={d.id === 'ab' ? 82 : 76} textAnchor="middle">
            {addr}
          </text>
        )}
      </svg>
    );
  }

  // Box instructions
  const lines: [string, string][] = [];
  info.operands.forEach((spec, i) => {
    const text = el.operands[i];
    let label = spec.label === 'a' ? 'A' : spec.label === 'b' ? 'B' : '';
    if (info.category === 'timer' && i === 1) label = d.id === 'ab' ? 'PRE' : 'PT';
    if (info.category === 'counter' && i === 1) label = d.id === 'ab' ? 'PRE' : 'PV';
    if (info.category === 'counter' && i === 2) label = 'CD';
    if (spec.label === 'source') label = d.id === 'ab' ? 'Src' : 'IN';
    if (spec.label === 'dest') label = d.id === 'ab' ? 'Dest' : 'OUT';
    if (i === 0 && (info.category === 'timer' || info.category === 'counter')) return;
    let shown = displayOperand(text, project, spec.kind);
    const live = values ? liveValue(values, text) : undefined;
    if (
      live !== undefined &&
      spec.kind !== 'time' &&
      (info.category === 'compare' || info.category === 'math')
    )
      shown += ` = ${formatValue(live)}`;
    lines.push([label, shown]);
  });
  const target =
    values && (info.category === 'timer' || info.category === 'counter')
      ? values[(el.operands[0] ?? '').trim()]
      : undefined;
  if (target && typeof target === 'object') {
    const accLabel = d.id === 'ab' ? 'ACC' : info.category === 'timer' ? 'ET' : 'CV';
    lines.push([accLabel, info.category === 'timer' ? formatMs(target.acc) : String(target.acc)]);
  }
  const title = d.mnemonic(el.instr);
  const header = info.category === 'timer' || info.category === 'counter' ? name : '';
  return (
    <svg width={CW} height={CH} className="glyph">
      <line className={cls(pin)} x1={0} y1={WY} x2={8} y2={WY} />
      <line className={cls(pout)} x1={CW - 8} y1={WY} x2={CW} y2={WY} />
      <rect
        className={pout ? 'box on' : pin ? 'box in' : 'box'}
        x={8}
        y={6}
        width={CW - 16}
        height={CH - 10}
        rx={3}
      />
      <text className="box-title" x={mid} y={19} textAnchor="middle">
        {title}
      </text>
      {header && (
        <text
          className={header === '???' ? 'box-header missing' : 'box-header'}
          x={mid}
          y={31}
          textAnchor="middle"
        >
          {truncate(header, 13)}
        </text>
      )}
      {lines.slice(0, header ? 3 : 4).map(([label, value], i) => (
        <text key={i} className="box-line" x={13} y={(header ? 44 : 33) + i * 12}>
          {label && <tspan className="box-label">{label} </tspan>}
          {truncate(value, label ? 11 : 14)}
        </text>
      ))}
    </svg>
  );
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

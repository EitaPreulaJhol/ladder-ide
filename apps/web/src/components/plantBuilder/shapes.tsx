/**
 * SVG drawings of the plant components, in the component's local frame
 * (0,0 = top-left of its box). Operator devices are interactive when `live`.
 */
import { useRef } from 'react';
import {
  boolParam,
  numParam,
  strParam,
  type BinCompState,
  type ConveyorCompState,
  type CylinderCompState,
  type FeederCompState,
  type MotorCompState,
  type OperatorCompState,
  type OvenCompState,
  type PlantComponent,
  type PumpCompState,
  type SensorCompState,
  type TankCompState,
  type ValveCompState,
  type Value,
} from '@ladder/core';
import { formatValue } from '../editor/format.ts';

export interface ShapeProps {
  c: PlantComponent;
  /** Runtime state of the component (shape depends on the kind). */
  s: unknown;
  /** Value of the tag bound to a port (field view: faulty outputs already applied). */
  port: (name: string) => Value | undefined;
  /** Operator interaction enabled (operate mode). */
  live: boolean;
  act: (action: string, value?: unknown) => void;
}

const on = (v: Value | undefined) => v === true || (typeof v === 'number' && v !== 0);
const OFF_FILL = '#1f2937';
const STROKE = '#64748b';

/** Horizontal drag track mapping pointer x to 0..1 (potentiometers, manual valves). */
function Track({
  x,
  y,
  w,
  value,
  live,
  onChange,
  color = '#38bdf8',
}: {
  x: number;
  y: number;
  w: number;
  value: number;
  live: boolean;
  onChange: (v: number) => void;
  color?: string;
}) {
  const ref = useRef<SVGRectElement>(null);
  const setFrom = (e: React.PointerEvent) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box || box.width === 0) return;
    onChange(Math.max(0, Math.min(1, (e.clientX - box.left) / box.width)));
  };
  return (
    <g
      className={live ? 'pb-live' : undefined}
      onPointerDown={(e) => {
        if (!live) return;
        e.stopPropagation();
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
        setFrom(e);
      }}
      onPointerMove={(e) => live && e.buttons === 1 && setFrom(e)}
    >
      <rect ref={ref} x={x} y={y - 8} width={w} height={16} fill="transparent" />
      <rect x={x} y={y - 3} width={w} height={6} rx={3} fill="#1e293b" stroke="#475569" />
      <rect x={x} y={y - 3} width={w * value} height={6} rx={3} fill={color} />
      <circle cx={x + w * value} cy={y} r={7} fill="#e2e8f0" stroke="#475569" />
    </g>
  );
}

function Conveyor({ c, s }: ShapeProps) {
  const v = (s as ConveyorCompState | undefined)?.v ?? 0;
  return (
    <g>
      <rect width={c.w} height={14} rx={7} fill="#334155" stroke={v ? '#22c55e' : STROKE} strokeWidth={2} />
      <line
        x1={7}
        y1={7}
        x2={c.w - 7}
        y2={7}
        stroke="#64748b"
        strokeDasharray="6 8"
        strokeWidth={2}
        className={v > 0 ? 'belt-fwd' : v < 0 ? 'belt-rev' : undefined}
      />
      <circle cx={7} cy={7} r={4} fill="#0f172a" stroke={STROKE} />
      <circle cx={c.w - 7} cy={7} r={4} fill="#0f172a" stroke={STROKE} />
    </g>
  );
}

function Feeder({ c, s, live, act }: ShapeProps) {
  const st = s as FeederCompState | undefined;
  const auto = (st?.auto ?? true) && numParam(c, 'interval') > 0;
  return (
    <g className={live ? 'pb-live' : undefined} onClick={() => live && act('drop')}>
      <polygon
        points={`0,0 ${c.w},0 ${c.w * 0.75},${c.h} ${c.w * 0.25},${c.h}`}
        fill="#1e293b"
        stroke={auto ? '#38bdf8' : STROKE}
        strokeWidth={1.5}
      />
      <text x={c.w / 2} y={c.h * 0.45} textAnchor="middle" className="plant-label">
        {st?.fed ?? 0}
      </text>
    </g>
  );
}

function PartSensor({ c, s }: ShapeProps) {
  const active = (s as SensorCompState | undefined)?.on ?? false;
  const inductive = strParam(c, 'type') === 'inductive';
  const color = active ? '#f43f5e' : '#475569';
  return (
    <g>
      <line
        x1={c.w / 2}
        y1={c.h}
        x2={c.w / 2}
        y2={c.h + numParam(c, 'range')}
        stroke={active ? '#f43f5e' : '#334155'}
        strokeWidth={2}
        strokeDasharray="3 2"
      />
      {inductive ? (
        <circle cx={c.w / 2} cy={c.h / 2} r={c.w / 2} fill={color} stroke="#fbbf24" strokeWidth={1.5} />
      ) : (
        <rect width={c.w} height={c.h} rx={3} fill={color} stroke="#94a3b8" />
      )}
    </g>
  );
}

function Pusher({ c, s, port }: ShapeProps) {
  const pos = (s as CylinderCompState | undefined)?.pos ?? 0;
  const down = strParam(c, 'dir') === 'down';
  const plateY = 16 - pos * 22;
  return (
    <g transform={down ? `translate(0 ${c.h}) scale(1 -1)` : undefined}>
      <rect x={11} y={plateY + 6} width={6} height={Math.max(0, 24 - plateY - 6)} fill="#64748b" />
      <rect x={0} y={plateY} width={c.w} height={6} rx={1} fill="#94a3b8" />
      <rect
        x={3}
        y={24}
        width={c.w - 6}
        height={c.h - 24}
        rx={3}
        fill={on(port('extend')) ? '#14532d' : '#1e293b'}
        stroke="#475569"
      />
    </g>
  );
}

function Bin({ c, s }: ShapeProps) {
  const st = s as BinCompState | undefined;
  const cap = numParam(c, 'capacity');
  const full = cap > 0 && (st?.count ?? 0) >= cap;
  return (
    <g>
      <rect width={c.w} height={c.h} fill="#0f172a" opacity={0.6} />
      <path
        d={`M0 0 V${c.h} H${c.w} V0`}
        fill="none"
        stroke={full ? '#f87171' : '#94a3b8'}
        strokeWidth={2.5}
      />
      <text x={c.w / 2} y={c.h / 2 + 5} textAnchor="middle" className="plant-label strong">
        {st?.count ?? 0}
        {cap > 0 ? `/${cap}` : ''}
      </text>
      {!!st?.count && (
        <text x={c.w / 2} y={c.h - 4} textAnchor="middle" className="plant-label">
          ▮{st.tall} ▪{st.count - st.tall}
          {st.metal ? ` ⛭${st.metal}` : ''}
        </text>
      )}
    </g>
  );
}

function Cylinder({ c, s, port }: ShapeProps) {
  const st = s as CylinderCompState | undefined;
  const pos = st?.pos ?? 0;
  const vertical = strParam(c, 'orient') === 'v';
  const len = vertical ? c.h : c.w;
  const thick = vertical ? c.w : c.h;
  const body = len * 0.55;
  const travel = len - body - 8;
  const rodEnd = body + pos * travel;
  const extending = on(port('extend'));
  const inner = (
    <g>
      <rect
        x={body}
        y={1}
        width={len - body}
        height={thick - 2}
        fill="none"
        stroke="#1e293b"
        strokeDasharray="3 3"
      />
      <rect x={body} y={thick / 2 - 3} width={rodEnd - body + 2} height={6} fill="#94a3b8" />
      <rect x={rodEnd} y={2} width={8} height={thick - 4} rx={1} fill="#cbd5e1" />
      <rect width={body} height={thick} rx={4} fill={extending ? '#14532d' : '#1e293b'} stroke="#475569" />
      <rect x={4 + pos * (body - 14)} y={3} width={6} height={thick - 6} fill="#64748b" />
      <circle cx={body - 6} cy={-5} r={3.5} fill={pos >= 0.99 ? '#f43f5e' : '#334155'} />
      <circle cx={6} cy={-5} r={3.5} fill={pos <= 0.01 ? '#f43f5e' : '#334155'} />
    </g>
  );
  return vertical ? <g transform={`translate(${c.w} 0) rotate(90)`}>{inner}</g> : inner;
}

function Motor({ c, s }: ShapeProps) {
  const st = s as MotorCompState | undefined;
  const speed = st?.speed ?? 0;
  const r = Math.min(c.w, c.h) / 2 - 2;
  const cx = c.w / 2;
  const cy = c.h / 2;
  const spinning = Math.abs(speed) > 0.02;
  const fault = st?.short || st?.tripped;
  return (
    <g>
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="#0f172a"
        stroke={fault ? '#f87171' : spinning ? '#22c55e' : STROKE}
        strokeWidth={2.5}
      />
      <g
        className={spinning ? 'spin' : undefined}
        style={{
          transformOrigin: `${cx}px ${cy}px`,
          animationDuration: `${Math.max(0.15, 0.6 / Math.max(Math.abs(speed), 0.05))}s`,
          animationDirection: speed < 0 ? 'reverse' : undefined,
        }}
      >
        {[0, 120, 240].map((a) => (
          <path
            key={a}
            d={`M${cx} ${cy} L${cx - r * 0.2} ${cy - r * 0.72} Q${cx} ${cy - r * 0.9} ${cx + r * 0.2} ${cy - r * 0.72} Z`}
            fill={st?.heavy ? '#fb923c' : '#94a3b8'}
            transform={`rotate(${a} ${cx} ${cy})`}
          />
        ))}
      </g>
      <rect x={4} y={c.h + 3} width={c.w - 8} height={4} rx={2} fill="#1e293b" />
      <rect
        x={4}
        y={c.h + 3}
        width={(c.w - 8) * Math.min(1, (st?.temperature ?? 0) / 1)}
        height={4}
        rx={2}
        fill={st?.tripped ? '#ef4444' : '#f59e0b'}
      />
      <text x={cx} y={c.h + 32} textAnchor="middle" className={st?.short ? 'plant-alert' : 'plant-label'}>
        {st?.short
          ? '⚡ I × 20'
          : `${st?.mode === 'star' ? 'Y · ' : st?.mode === 'delta' ? 'Δ · ' : ''}${Math.round(speed * 100)}%${
              st && st.mode !== 'off' ? ` · ${st.current.toFixed(1)}×In` : ''
            }`}
      </text>
    </g>
  );
}

function Tank({ c, s }: ShapeProps) {
  const st = s as TankCompState | undefined;
  const level = st?.level ?? 0;
  const lsl = numParam(c, 'lslPct') / 100;
  const lsh = numParam(c, 'lshPct') / 100;
  const yOf = (f: number) => c.h - f * c.h;
  const wired = (p: string) => !!c.tags[p];
  return (
    <g>
      <rect
        width={c.w}
        height={c.h}
        rx={6}
        fill="#0f172a"
        stroke={st?.overflowing ? '#f87171' : STROKE}
        strokeWidth={2}
      />
      <rect
        x={2}
        y={yOf(level)}
        width={c.w - 4}
        height={Math.max(0, level * c.h - 2)}
        rx={4}
        fill="#0369a1"
        opacity={0.85}
      />
      {[
        ['lsl', lsl],
        ['lsh', lsh],
      ].map(([p, f]) =>
        wired(p as string) ? (
          <g key={p as string}>
            <line
              x1={-8}
              x2={6}
              y1={yOf(f as number)}
              y2={yOf(f as number)}
              stroke="#94a3b8"
              strokeWidth={2}
            />
            <circle
              cx={-10}
              cy={yOf(f as number)}
              r={4}
              fill={level >= (f as number) ? '#22c55e' : '#334155'}
            />
          </g>
        ) : null,
      )}
      <text x={c.w / 2} y={c.h / 2 + 6} textAnchor="middle" className="plant-big">
        {Math.round(level * 100)}%
      </text>
      {!!st?.overflows && (
        <text x={c.w / 2} y={-6} textAnchor="middle" className="plant-alert">
          ⚠ {st.overflows}
        </text>
      )}
    </g>
  );
}

function Pump({ c, s }: ShapeProps) {
  const st = s as PumpCompState | undefined;
  const r = Math.min(c.w, c.h) / 2 - 2;
  const cx = c.w / 2;
  const cy = c.h / 2;
  return (
    <g>
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="#0f172a"
        stroke={st?.dry ? '#f59e0b' : st?.running ? '#22c55e' : STROKE}
        strokeWidth={2.5}
      />
      <g
        className={st?.running ? 'spin' : undefined}
        style={{ transformOrigin: `${cx}px ${cy}px`, animationDuration: '0.5s' }}
      >
        <polygon
          points={`${cx - r * 0.5},${cy - r * 0.6} ${cx + r * 0.7},${cy} ${cx - r * 0.5},${cy + r * 0.6}`}
          fill="#94a3b8"
        />
      </g>
    </g>
  );
}

function Valve({ c, s, live, act }: ShapeProps) {
  const st = s as ValveCompState | undefined;
  const opening = st?.opening ?? 0;
  const mode = strParam(c, 'mode');
  const bodyY = 12;
  const bh = c.h - bodyY;
  const fill = opening > 0.02 ? `rgba(56, 189, 248, ${0.3 + 0.7 * opening})` : OFF_FILL;
  return (
    <g>
      <polygon points={`0,${bodyY} ${c.w / 2},${bodyY + bh / 2} 0,${c.h}`} fill={fill} stroke="#94a3b8" />
      <polygon
        points={`${c.w},${bodyY} ${c.w / 2},${bodyY + bh / 2} ${c.w},${c.h}`}
        fill={fill}
        stroke="#94a3b8"
      />
      <line x1={c.w / 2} y1={bodyY + bh / 2} x2={c.w / 2} y2={6} stroke="#94a3b8" strokeWidth={2} />
      {mode === 'manual' ? (
        <line x1={c.w / 2 - 9} x2={c.w / 2 + 9} y1={4} y2={4} stroke="#cbd5e1" strokeWidth={3} />
      ) : (
        <rect
          x={c.w / 2 - 9}
          y={0}
          width={18}
          height={7}
          rx={2}
          fill={mode === 'proportional' ? '#334155' : '#1e293b'}
          stroke="#94a3b8"
        />
      )}
      <text x={c.w / 2 + 12} y={8} className="plant-label">
        {Math.round(opening * 100)}%
      </text>
      {mode === 'manual' && (
        <Track
          x={-6}
          y={c.h + 26}
          w={c.w + 12}
          value={st?.manual ?? 0}
          live={live}
          onChange={(v) => act('set', v)}
        />
      )}
    </g>
  );
}

function Lamp({ c, port }: ShapeProps) {
  const lit = on(port('on'));
  const color = strParam(c, 'color');
  const r = Math.min(c.w, c.h) / 2;
  return (
    <circle
      cx={c.w / 2}
      cy={c.h / 2}
      r={r - 1}
      fill={lit ? color : OFF_FILL}
      stroke="#475569"
      strokeWidth={1.5}
      style={lit ? { filter: `drop-shadow(0 0 6px ${color})` } : undefined}
    />
  );
}

function Siren({ c, port }: ShapeProps) {
  const lit = on(port('on'));
  const h = c.h;
  return (
    <g>
      <path
        d={`M2 ${h * 0.35} H${h * 0.3} L${h * 0.6} ${h * 0.1} V${h * 0.9} L${h * 0.3} ${h * 0.65} H2 Z`}
        fill={lit ? '#f59e0b' : OFF_FILL}
        stroke="#94a3b8"
      />
      {lit &&
        [0, 1].map((i) => (
          <path
            key={i}
            className="siren-wave"
            style={{ animationDelay: `${i * 0.25}s` }}
            d={`M${h * 0.72 + i * 7} ${h * 0.25} Q${h * 0.9 + i * 8} ${h / 2} ${h * 0.72 + i * 7} ${h * 0.75}`}
            fill="none"
            stroke="#fbbf24"
            strokeWidth={2}
          />
        ))}
    </g>
  );
}

function TrafficLight({ c, port }: ShapeProps) {
  const lights =
    strParam(c, 'lights') === '2'
      ? [
          ['red', '#ef4444'],
          ['green', '#22c55e'],
        ]
      : [
          ['red', '#ef4444'],
          ['yellow', '#eab308'],
          ['green', '#22c55e'],
        ];
  const step = c.h / lights.length;
  const r = Math.min(c.w / 2 - 3, step / 2 - 3);
  return (
    <g>
      <rect width={c.w} height={c.h} rx={6} fill="#0f172a" stroke="#475569" />
      {lights.map(([p, color], i) => {
        const lit = on(port(p!));
        return (
          <circle
            key={p}
            cx={c.w / 2}
            cy={step * i + step / 2}
            r={r}
            fill={lit ? color : OFF_FILL}
            style={lit ? { filter: `drop-shadow(0 0 5px ${color})` } : undefined}
          />
        );
      })}
    </g>
  );
}

function Oven({ c, s, port }: ShapeProps) {
  const st = s as OvenCompState | undefined;
  const temp = st?.temp ?? numParam(c, 'ambient');
  const heating = on(port('heat')) || (typeof port('power') === 'number' && (port('power') as number) > 0);
  const maxC = Math.max(1, numParam(c, 'maxC'));
  const frac = Math.max(0, Math.min(1, temp / maxC));
  const tsh = Math.max(0, Math.min(1, numParam(c, 'tshC') / maxC));
  const zig = Array.from(
    { length: 8 },
    (_, i) => `${10 + (i * (c.w - 34)) / 7},${c.h - (i % 2 ? 8 : 16)}`,
  ).join(' ');
  return (
    <g>
      <rect
        width={c.w}
        height={c.h}
        rx={6}
        fill="#0f172a"
        stroke={st?.hot ? '#f87171' : STROKE}
        strokeWidth={2}
      />
      <polyline points={zig} fill="none" stroke={heating ? '#f97316' : '#475569'} strokeWidth={2.5} />
      <text x={(c.w - 14) / 2} y={c.h / 2} textAnchor="middle" className="plant-big">
        {temp.toFixed(0)}°C
      </text>
      <rect x={c.w - 12} y={6} width={6} height={c.h - 12} rx={3} fill="#1e293b" />
      <rect
        x={c.w - 12}
        y={6 + (c.h - 12) * (1 - frac)}
        width={6}
        height={(c.h - 12) * frac}
        rx={3}
        fill="#ef4444"
      />
      <line
        x1={c.w - 15}
        x2={c.w - 3}
        y1={6 + (c.h - 12) * (1 - tsh)}
        y2={6 + (c.h - 12) * (1 - tsh)}
        stroke="#e2e8f0"
        strokeWidth={1.5}
      />
      {c.tags.fan && (
        <text x={8} y={16} className={on(port('fan')) ? 'plant-label strong spin-slow' : 'plant-label'}>
          ✣
        </text>
      )}
    </g>
  );
}

function Display({ c, port }: ShapeProps) {
  const v = port('value');
  const decimals = numParam(c, 'decimals');
  const text =
    typeof v === 'number'
      ? v.toFixed(Math.max(0, Math.min(4, decimals)))
      : v === undefined
        ? '—'
        : formatValue(v);
  return (
    <g>
      <rect width={c.w} height={c.h} rx={4} fill="#020617" stroke="#475569" />
      <text x={c.w - 6} y={c.h / 2 + 7} textAnchor="end" className="plant-big">
        {text}
        {strParam(c, 'unit') && <tspan className="plant-label"> {strParam(c, 'unit')}</tspan>}
      </text>
    </g>
  );
}

function Pushbutton({ c, s, live, act }: ShapeProps) {
  const pressed = (s as OperatorCompState | undefined)?.value === true;
  const cx = c.w / 2;
  const r = Math.min(c.w / 2, c.h / 2) - 4;
  return (
    <g
      className={live ? 'pb-live' : undefined}
      onPointerDown={(e) => {
        if (!live) return;
        e.stopPropagation();
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
        act('press');
      }}
      onPointerUp={() => live && act('release')}
      onPointerCancel={() => live && act('release')}
    >
      <rect x={1} y={1} width={c.w - 2} height={c.h - 2} rx={6} fill="#111827" stroke="#374151" />
      <circle
        cx={cx}
        cy={c.h / 2 + (pressed ? 2 : 0)}
        r={r}
        fill={strParam(c, 'color')}
        stroke="#0b0f17"
        strokeWidth={3}
        style={pressed ? { filter: 'brightness(1.35)' } : undefined}
      />
      {boolParam(c, 'nc') && (
        <text x={cx} y={c.h - 4} textAnchor="middle" className="plant-label">
          NF
        </text>
      )}
    </g>
  );
}

function Selector({ c, s, live, act }: ShapeProps) {
  const v = (s as OperatorCompState | undefined)?.value === true;
  const cx = c.w / 2;
  const cy = c.h / 2 + 4;
  const r = Math.min(c.w / 2, c.h / 2) - 6;
  return (
    <g className={live ? 'pb-live' : undefined} onClick={() => live && act('toggle')}>
      <rect x={1} y={1} width={c.w - 2} height={c.h - 2} rx={6} fill="#111827" stroke="#374151" />
      <text x={6} y={12} className="plant-label">
        0
      </text>
      <text x={c.w - 6} y={12} textAnchor="end" className="plant-label">
        1
      </text>
      <circle cx={cx} cy={cy} r={r} fill="#1f2937" stroke="#94a3b8" strokeWidth={2} />
      <rect
        x={cx - 3}
        y={cy - r + 2}
        width={6}
        height={2 * r - 4}
        rx={3}
        fill={v ? '#22c55e' : '#cbd5e1'}
        transform={`rotate(${v ? 45 : -45} ${cx} ${cy})`}
      />
    </g>
  );
}

function Estop({ c, s, live, act }: ShapeProps) {
  const pressed = (s as OperatorCompState | undefined)?.value === true;
  const cx = c.w / 2;
  const cy = c.h / 2;
  const r = Math.min(c.w, c.h) / 2 - 2;
  return (
    <g className={live ? 'pb-live' : undefined} onClick={() => live && act('toggle')}>
      <circle cx={cx} cy={cy} r={r} fill="#facc15" stroke="#854d0e" />
      <circle
        cx={cx}
        cy={cy}
        r={r * 0.62}
        fill={pressed ? '#991b1b' : '#dc2626'}
        stroke="#450a0a"
        strokeWidth={pressed ? 4 : 2}
      />
      {pressed && (
        <text x={cx} y={cy + 4} textAnchor="middle" className="plant-label strong">
          ⟲
        </text>
      )}
    </g>
  );
}

function Potentiometer({ c, s, live, act }: ShapeProps) {
  const v = Number((s as OperatorCompState | undefined)?.value ?? 0);
  const min = numParam(c, 'min');
  const max = numParam(c, 'max');
  const out = min + v * (max - min);
  return (
    <g>
      <rect width={c.w} height={c.h} rx={6} fill="#111827" stroke="#374151" />
      <text x={c.w / 2} y={14} textAnchor="middle" className="plant-label strong">
        {Math.abs(max - min) <= 1000 ? out.toFixed(1) : Math.round(out)}
      </text>
      <Track x={12} y={c.h - 14} w={c.w - 24} value={v} live={live} onChange={(x) => act('set', x)} />
    </g>
  );
}

function Label({ c }: ShapeProps) {
  return (
    <text x={0} y={c.h * 0.75} className="plant-text" style={{ fontSize: numParam(c, 'size') }}>
      {c.label}
    </text>
  );
}

export const SHAPES: Record<PlantComponent['kind'], (p: ShapeProps) => React.ReactNode> = {
  conveyor: Conveyor,
  feeder: Feeder,
  partSensor: PartSensor,
  pusher: Pusher,
  bin: Bin,
  cylinder: Cylinder,
  motor: Motor,
  tank: Tank,
  pump: Pump,
  valve: Valve,
  lamp: Lamp,
  siren: Siren,
  trafficLight: TrafficLight,
  oven: Oven,
  display: Display,
  pushbutton: Pushbutton,
  selector: Selector,
  estop: Estop,
  potentiometer: Potentiometer,
  label: Label,
};

/** Where the component's caption goes (below by default, above sensors whose beam points down). */
export function captionY(c: PlantComponent): number | null {
  if (c.kind === 'label') return null;
  if (c.kind === 'partSensor' || c.kind === 'feeder') return -4;
  if (c.kind === 'motor') return c.h + 20;
  if (c.kind === 'valve' && strParam(c, 'mode') === 'manual') return c.h + 46;
  return c.h + 12;
}

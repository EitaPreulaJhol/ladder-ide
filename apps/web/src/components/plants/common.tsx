import type { Value } from '@ladder/core';

export interface PlantProps<S> {
  state: S;
  values: Record<string, Value> | undefined;
  setInput: (name: string, v: boolean | number) => void;
  action: (name: string, value?: unknown) => void;
}

export const bit = (values: Record<string, Value> | undefined, name: string) => {
  const v = values?.[name];
  return typeof v === 'boolean' ? v : typeof v === 'number' ? v !== 0 : false;
};

/** Momentary operator pushbutton; `nc` buttons read 1 at rest and 0 while pressed. */
export function PlantButton({
  tag,
  label,
  color,
  nc = false,
  setInput,
}: {
  tag: string;
  label: string;
  color: string;
  nc?: boolean;
  setInput: (name: string, v: boolean | number) => void;
}) {
  return (
    <button
      className="plant-btn"
      style={{ '--pb': color } as React.CSSProperties}
      data-testid={`plant-${tag}`}
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        setInput(tag, !nc);
      }}
      onPointerUp={() => setInput(tag, nc)}
      onPointerCancel={() => setInput(tag, nc)}
    >
      <span className="cap" />
      {label}
      <small>{tag}</small>
    </button>
  );
}

export function Lamp({
  on,
  color,
  x,
  y,
  r = 9,
  label,
}: {
  on: boolean;
  color: string;
  x: number;
  y: number;
  r?: number;
  label?: string;
}) {
  return (
    <g>
      <circle
        cx={x}
        cy={y}
        r={r}
        fill={on ? color : '#1f2937'}
        stroke="#475569"
        strokeWidth={1.5}
        style={on ? { filter: `drop-shadow(0 0 6px ${color})` } : undefined}
      />
      {label && (
        <text x={x} y={y + r + 12} textAnchor="middle" className="plant-label">
          {label}
        </text>
      )}
    </g>
  );
}

export function Contactor({ on, x, y, label }: { on: boolean; x: number; y: number; label: string }) {
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={44}
        height={30}
        rx={4}
        fill={on ? '#14532d' : '#1e293b'}
        stroke={on ? '#22c55e' : '#475569'}
        strokeWidth={1.5}
      />
      <text x={x + 22} y={y + 19} textAnchor="middle" className="plant-label strong">
        {label}
      </text>
    </g>
  );
}

export function Motor({ x, y, speed, label = 'M' }: { x: number; y: number; speed: number; label?: string }) {
  const spinning = speed > 0.02;
  return (
    <g>
      <circle
        cx={x}
        cy={y}
        r={30}
        fill="#0f172a"
        stroke={spinning ? '#22c55e' : '#64748b'}
        strokeWidth={2.5}
      />
      <g
        className={spinning ? 'spin' : undefined}
        style={{
          transformOrigin: `${x}px ${y}px`,
          animationDuration: `${Math.max(0.15, 0.6 / Math.max(speed, 0.05))}s`,
        }}
      >
        {[0, 120, 240].map((a) => (
          <path
            key={a}
            d={`M${x} ${y} L${x - 6} ${y - 22} Q${x} ${y - 27} ${x + 6} ${y - 22} Z`}
            fill="#94a3b8"
            transform={`rotate(${a} ${x} ${y})`}
          />
        ))}
      </g>
      <text x={x} y={y + 46} textAnchor="middle" className="plant-label">
        {label} {Math.round(speed * 100)}%
      </text>
    </g>
  );
}

export function Bar({
  x,
  y,
  w,
  h,
  value,
  color,
  label,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  value: number;
  color: string;
  label: string;
}) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={3} fill="#1e293b" stroke="#475569" />
      <rect x={x} y={y} width={Math.max(0, Math.min(1, value)) * w} height={h} rx={3} fill={color} />
      <text x={x} y={y - 4} className="plant-label">
        {label}
      </text>
    </g>
  );
}

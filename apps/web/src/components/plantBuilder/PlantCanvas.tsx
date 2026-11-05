import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  COMPONENT_DEFS,
  strParam,
  type PlantComponent,
  type PlantDesign,
  type PlantState,
  type PumpCompState,
  type ValveCompState,
} from '@ladder/core';
import { useSim } from '../../store/sim.ts';
import { captionY, SHAPES } from './shapes.tsx';

export const PLANT_GRID = 5;
const snap = (v: number) => Math.round(v / PLANT_GRID) * PLANT_GRID;

export type Geometry = Pick<PlantComponent, 'x' | 'y' | 'w' | 'h'>;

interface Props {
  design: PlantDesign;
  editing?: boolean;
  selected?: string | null;
  onSelect?: (id: string | null) => void;
  onGeometry?: (id: string, g: Geometry) => void;
}

/** Pipe from a tank (or the outside) to a pump / valve and on to the destination. */
function pipePath(c: PlantComponent, tanks: Map<string, PlantComponent>, end: 'from' | 'to'): string | null {
  const cx = c.x + c.w / 2;
  const cy = c.y + c.h - 10;
  const t = tanks.get(strParam(c, end));
  if (!t) {
    // Supply comes from the left, drain goes down: short stubs.
    return end === 'from' ? `M${c.x - 24} ${cy} H${c.x}` : `M${c.x + c.w} ${cy} h16 v18`;
  }
  const left = cx < t.x + t.w / 2;
  const tx = left ? t.x : t.x + t.w;
  const ty = end === 'from' ? t.y + t.h - 10 : t.y + 10;
  const sx = end === 'from' ? c.x : c.x + c.w;
  return end === 'from'
    ? `M${tx} ${ty} H${(tx + sx) / 2} V${cy} H${sx}`
    : `M${sx} ${cy} H${(tx + sx) / 2} V${ty} H${tx}`;
}

export function PlantCanvas({ design, editing = false, selected = null, onSelect, onGeometry }: Props) {
  const { t } = useTranslation();
  const svgRef = useRef<SVGSVGElement>(null);
  const state = useSim((s) => s.scenarioState) as PlantState | null;
  const plcValues = useSim((s) => s.snapshot?.values);
  const fieldOutputs = useSim((s) => s.faults.outputs);
  const plantAction = useSim((s) => s.plantAction);
  const [drag, setDrag] = useState<({ id: string } & Geometry) | null>(null);
  // The plant sees the field: faulty outputs override what the PLC commands.
  const values = useMemo(
    () => (plcValues && Object.keys(fieldOutputs).length ? { ...plcValues, ...fieldOutputs } : plcValues),
    [plcValues, fieldOutputs],
  );
  const live = !editing;
  const comps = state?.comps ?? {};
  const tanks = useMemo(
    () => new Map(design.components.filter((c) => c.kind === 'tank').map((c) => [c.id, c])),
    [design.components],
  );

  const startDrag = (e: React.PointerEvent, c: PlantComponent, mode: 'move' | 'resize') => {
    if (!editing) return;
    e.preventDefault();
    e.stopPropagation();
    onSelect?.(c.id);
    const box = svgRef.current?.getBoundingClientRect();
    const scale = box && box.width ? box.width / design.width : 1;
    const start = { px: e.clientX, py: e.clientY, x: c.x, y: c.y, w: c.w, h: c.h };
    const resize = COMPONENT_DEFS[c.kind].resize;
    let last: Geometry = { x: c.x, y: c.y, w: c.w, h: c.h };
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - start.px) / scale;
      const dy = (ev.clientY - start.py) / scale;
      last =
        mode === 'move'
          ? {
              ...last,
              x: Math.max(0, Math.min(design.width - PLANT_GRID, snap(start.x + dx))),
              y: Math.max(0, Math.min(design.height - PLANT_GRID, snap(start.y + dy))),
            }
          : {
              ...last,
              w: Math.max(10, Math.min(design.width - start.x, snap(start.w + dx))),
              h:
                resize === 'both'
                  ? Math.max(10, Math.min(design.height - start.y, snap(start.h + dy)))
                  : start.h,
            };
      setDrag({ id: c.id, ...last });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDrag(null);
      if (last.x !== c.x || last.y !== c.y || last.w !== c.w || last.h !== c.h) onGeometry?.(c.id, last);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const placed = design.components.map((c) => (drag?.id === c.id ? { ...c, ...drag, id: c.id } : c));

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${design.width} ${design.height}`}
      className={`plant-svg plant-canvas${editing ? ' editing' : ''}`}
      onPointerDown={(e) => editing && e.target === e.currentTarget && onSelect?.(null)}
      data-testid="plant-canvas"
    >
      {editing && (
        <>
          <defs>
            <pattern id="plant-grid" width={20} height={20} patternUnits="userSpaceOnUse">
              <path d="M20 0 H0 V20" fill="none" stroke="#1e293b" strokeWidth={1} />
            </pattern>
          </defs>
          <rect width={design.width} height={design.height} fill="url(#plant-grid)" pointerEvents="none" />
        </>
      )}

      {/* pipes under everything */}
      {placed
        .filter((c) => c.kind === 'pump' || c.kind === 'valve')
        .map((c) => {
          const st = comps[c.id] as PumpCompState | ValveCompState | undefined;
          const flowing = (st?.q ?? 0) > 0.01;
          return (['from', 'to'] as const).map((end) => {
            const d = pipePath(c, tanks, end);
            if (!d) return null;
            return (
              <g key={`${c.id}-${end}`} pointerEvents="none">
                <path d={d} fill="none" stroke="#334155" strokeWidth={5} strokeLinejoin="round" />
                {flowing && (
                  <path
                    d={d}
                    fill="none"
                    stroke="#38bdf8"
                    strokeWidth={2}
                    strokeDasharray="5 6"
                    className="pipe-flow"
                  />
                )}
              </g>
            );
          });
        })}

      {placed.map((c) => {
        const Shape = SHAPES[c.kind];
        const cap = captionY(c);
        return (
          <g key={c.id} transform={`translate(${c.x} ${c.y})`} data-testid={`pc-${c.kind}-${c.label}`}>
            <Shape
              c={c}
              s={comps[c.id]}
              port={(p) => {
                const tag = c.tags[p];
                return tag ? values?.[tag] : undefined;
              }}
              live={live}
              act={(action, value) => plantAction(`${c.id}:${action}`, value)}
            />
            {cap !== null && c.label && (
              <text x={c.w / 2} y={cap} textAnchor="middle" className="plant-label" pointerEvents="none">
                {c.label}
              </text>
            )}
          </g>
        );
      })}

      {/* parts */}
      {state?.parts?.map((p) => (
        <rect
          key={p.id}
          x={p.x - p.w / 2}
          y={p.y - p.h}
          width={p.w}
          height={p.h}
          rx={2}
          fill={p.metal ? '#94a3b8' : p.tall ? '#b45309' : '#a16207'}
          stroke={p.metal ? '#e2e8f0' : '#fbbf24'}
          opacity={p.mode === 'pushed' ? Math.max(0.25, 1 - p.travel / 120) : 1}
          pointerEvents="none"
        />
      ))}

      {editing &&
        placed.map((c) => {
          const sel = c.id === selected;
          const resizable = COMPONENT_DEFS[c.kind].resize !== 'none';
          return (
            <g key={`edit-${c.id}`}>
              <rect
                x={c.x - 2}
                y={c.y - 2}
                width={c.w + 4}
                height={c.h + 4}
                className={`pc-hit${sel ? ' selected' : ''}`}
                onPointerDown={(e) => startDrag(e, c, 'move')}
                data-testid={`pc-hit-${c.label || c.kind}`}
              >
                <title>
                  {t(`builder.kinds.${c.kind}`)}
                  {c.label ? ` · ${c.label}` : ''}
                  {Object.entries(c.tags)
                    .filter(([, v]) => v)
                    .map(([p, v]) => `\n${t(`builder.ports.${p}`)}: ${v}`)
                    .join('')}
                </title>
              </rect>
              {sel && resizable && (
                <rect
                  x={c.x + c.w - 4}
                  y={c.y + c.h - 4}
                  width={9}
                  height={9}
                  className="pc-resize"
                  onPointerDown={(e) => startDrag(e, c, 'resize')}
                />
              )}
            </g>
          );
        })}
    </svg>
  );
}

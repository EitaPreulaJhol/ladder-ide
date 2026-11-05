import { useEffect, useRef, useState } from 'react';
import { locale } from '../../i18n.ts';
import { useTranslation } from 'react-i18next';
import type { TrendEvent } from '@ladder/core';
import { formatMs } from '../editor/format.ts';

/**
 * Logic-analyzer style trend: one lane per signal (small multiples) sharing the
 * time axis. Digital lanes are steps between 0 and 1; analog lanes are steps with
 * their own auto-scaled range (never a second axis on the same lane).
 */

const LABEL_W = 132;
const LANE_DIGITAL = 26;
const LANE_ANALOG = 56;
const GAP = 12;
const TOP = 8;
const AXIS_H = 22;
const RIGHT = 12;

export interface TrendSeries {
  signal: string;
  label: string;
  events: TrendEvent[];
  /** Optional value formatter (e.g. timer accumulators shown as time). */
  format?: (v: number | boolean) => string;
}

interface Props {
  series: TrendSeries[];
  startMs: number;
  endMs: number;
  /** Optional marker (e.g. the instant a check failed). */
  markerMs?: number;
  markerLabel?: string;
}

/** Value active at time t (last event at or before t). */
export function valueAt(events: TrendEvent[], t: number): number | boolean | undefined {
  let lo = 0;
  let hi = events.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (events[mid]![0] <= t) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found >= 0 ? events[found]![1] : undefined;
}

const num = (v: number | boolean) => (typeof v === 'boolean' ? (v ? 1 : 0) : v);
const isDigital = (events: TrendEvent[]) => events.length === 0 || typeof events[0]![1] === 'boolean';

export function formatTrendValue(v: number | boolean | undefined): string {
  if (v === undefined) return '—';
  if (typeof v === 'boolean') return v ? '1' : '0';
  return Number.isInteger(v)
    ? v.toLocaleString(locale())
    : v.toLocaleString(locale(), { maximumFractionDigits: 2 });
}

function tickLabel(tm: number, step: number): string {
  if (step < 1000) return `${(tm / 1000).toLocaleString(locale(), { maximumFractionDigits: 2 })}s`;
  if (tm < 60_000) return `${tm / 1000}s`;
  const m = Math.floor(tm / 60_000);
  const sec = Math.round((tm % 60_000) / 1000);
  return `${m}m${sec ? String(sec).padStart(2, '0') + 's' : ''}`;
}

const TICK_STEPS = [
  10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10_000, 20_000, 30_000, 60_000, 120_000, 300_000,
];

function niceRange(min: number, max: number): [number, number] {
  if (min === max) return [min - 1, max + 1];
  const pad = (max - min) * 0.08;
  return [min - pad, max + pad];
}

export function TrendChart({ series, startMs, endMs, markerMs, markerLabel }: Props) {
  const { t } = useTranslation();
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [cursor, setCursor] = useState<number | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(320, el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const span = Math.max(1, endMs - startMs);
  const plotW = width - LABEL_W - RIGHT;
  const x = (tm: number) => LABEL_W + ((tm - startMs) / span) * plotW;
  const tAt = (px: number) => startMs + ((px - LABEL_W) / plotW) * span;

  // Lane geometry: each lane starts below the previous ones.
  const heights = series.map((s) => (isDigital(s.events) ? LANE_DIGITAL : LANE_ANALOG));
  const tops = heights.map((_, i) => TOP + heights.slice(0, i).reduce((acc, h) => acc + h + GAP, 0));
  const y = TOP + heights.reduce((acc, h) => acc + h + GAP, 0);
  const lanes = series.map((s, i) => {
    const digital = isDigital(s.events);
    const h = heights[i]!;
    const top = tops[i]!;
    let lo = 0;
    let hi = 1;
    let vMin = 0;
    let vMax = 1;
    if (!digital) {
      const visible = s.events.filter((e) => e[0] >= startMs && e[0] <= endMs).map((e) => num(e[1]));
      const first = valueAt(s.events, startMs);
      if (first !== undefined) visible.push(num(first));
      vMin = visible.length ? Math.min(...visible) : 0;
      vMax = visible.length ? Math.max(...visible) : 1;
      [lo, hi] = niceRange(vMin, vMax);
    }
    const yOf = (v: number | boolean) => {
      const n = num(v);
      const frac = (n - lo) / (hi - lo);
      return top + h - (digital ? 3 : 4) - frac * (h - (digital ? 6 : 8));
    };
    // Step path across the window
    let d = '';
    let areaStart: number | null = null;
    const v0 = valueAt(s.events, startMs);
    let lastY: number | null = null;
    if (v0 !== undefined) {
      lastY = yOf(v0);
      d = `M${x(startMs)},${lastY}`;
      areaStart = x(startMs);
    }
    for (const [tm, v] of s.events) {
      if (tm <= startMs || tm > endMs) continue;
      const ny = yOf(v);
      if (lastY === null) {
        d = `M${x(tm)},${ny}`;
        areaStart = x(tm);
      } else d += `H${x(tm)}V${ny}`;
      lastY = ny;
    }
    if (lastY !== null) d += `H${x(endMs)}`;
    const base = top + h;
    const area = d && areaStart !== null ? `${d}V${base}H${areaStart}Z` : '';
    return { s, digital, top, h, d, area, vMin, vMax };
  });
  const plotBottom = Math.max(y - GAP, TOP + LANE_DIGITAL);
  const height = plotBottom + AXIS_H;

  // Time ticks: about one every 90px
  const step = TICK_STEPS.find((st) => (st / span) * plotW >= 90) ?? TICK_STEPS[TICK_STEPS.length - 1]!;
  const ticks: number[] = [];
  for (let tm = Math.ceil(startMs / step) * step; tm <= endMs; tm += step) ticks.push(tm);

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const rect = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
    const tm = tAt(e.clientX - rect.left);
    setCursor(Math.max(startMs, Math.min(endMs, tm)));
  };
  const onKey = (e: React.KeyboardEvent) => {
    const delta = span / 50;
    const base = cursor ?? endMs;
    if (e.key === 'ArrowLeft') setCursor(Math.max(startMs, base - delta));
    else if (e.key === 'ArrowRight') setCursor(Math.min(endMs, base + delta));
    else if (e.key === 'Home') setCursor(startMs);
    else if (e.key === 'End') setCursor(endMs);
    else if (e.key === 'Escape') setCursor(null);
    else return;
    e.preventDefault();
  };

  const cx = cursor !== null ? x(cursor) : 0;
  const tipLeft = cx + 14 + 220 > width ? cx - 14 - 220 : cx + 14;

  return (
    <div
      className="trend-chart"
      ref={wrap}
      tabIndex={0}
      onKeyDown={onKey}
      onBlur={() => setCursor(null)}
      aria-label={t('trend.chartLabel', { n: series.length })}
    >
      <svg width={width} height={height} role="img" aria-label={t('trend.chartLabel', { n: series.length })}>
        {ticks.map((tm) => (
          <g key={tm}>
            <line className="trend-grid" x1={x(tm)} x2={x(tm)} y1={TOP - 4} y2={plotBottom} />
            <text className="trend-tick" x={x(tm)} y={plotBottom + 15} textAnchor="middle">
              {tickLabel(tm, step)}
            </text>
          </g>
        ))}
        {lanes.map(({ s, digital, top, h, d, area, vMin, vMax }) => (
          <g key={s.signal} className={digital ? 'trend-lane digital' : 'trend-lane analog'}>
            <line className="trend-base" x1={LABEL_W} x2={LABEL_W + plotW} y1={top + h} y2={top + h} />
            <text className="trend-label" x={LABEL_W - 10} y={top + h / 2 + 4} textAnchor="end">
              {s.label.length > 16 ? s.label.slice(0, 15) + '…' : s.label}
            </text>
            {!digital && (
              <>
                <text className="trend-range" x={LABEL_W + 4} y={top + 9}>
                  {(s.format ?? formatTrendValue)(vMax)}
                </text>
                <text className="trend-range" x={LABEL_W + 4} y={top + h - 3}>
                  {(s.format ?? formatTrendValue)(vMin)}
                </text>
              </>
            )}
            {area && <path className="trend-area" d={area} />}
            {d && <path className="trend-line" d={d} />}
          </g>
        ))}
        {markerMs !== undefined && markerMs >= startMs && markerMs <= endMs && (
          <g>
            <line className="trend-marker" x1={x(markerMs)} x2={x(markerMs)} y1={TOP - 4} y2={plotBottom} />
            {markerLabel && (
              <text
                className="trend-marker-label"
                x={x(markerMs) > LABEL_W + plotW - 60 ? x(markerMs) - 4 : x(markerMs) + 4}
                y={TOP + 6}
                textAnchor={x(markerMs) > LABEL_W + plotW - 60 ? 'end' : 'start'}
              >
                {markerLabel}
              </text>
            )}
          </g>
        )}
        {cursor !== null && <line className="trend-cursor" x1={cx} x2={cx} y1={TOP - 4} y2={plotBottom} />}
        <rect
          className="trend-hit"
          x={LABEL_W}
          y={0}
          width={plotW}
          height={plotBottom}
          onPointerMove={onMove}
          onPointerLeave={() => setCursor(null)}
        />
      </svg>
      {cursor !== null && (
        <div className="trend-tip" style={{ left: tipLeft, top: TOP }} role="status">
          <div className="trend-tip-time">t = {formatMs(Math.round(cursor))}</div>
          {series.map((s) => (
            <div key={s.signal} className="trend-tip-row">
              <span className={isDigital(s.events) ? 'key digital' : 'key analog'} />
              <strong>
                {(() => {
                  const v = valueAt(s.events, cursor);
                  return v === undefined ? '—' : (s.format ?? formatTrendValue)(v);
                })()}
              </strong>
              <span className="muted">{s.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

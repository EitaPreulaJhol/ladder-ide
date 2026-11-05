/**
 * Records signal changes scan by scan (event based), so even one-scan pulses
 * are kept while the data stays small. Used by the trend chart and the grader.
 */
import type { Simulator } from './engine.ts';

/** [time in ms, value] — a value starts at that time and holds until the next event. */
export type TrendEvent = [number, number | boolean];

export interface TrendData {
  signals: string[];
  /** Events per signal, oldest first. */
  events: Record<string, TrendEvent[]>;
  /** Simulated time of the last recorded scan. */
  endMs: number;
}

export class SignalRecorder {
  private signals: string[] = [];
  private events: Record<string, TrendEvent[]> = {};
  private last = new Map<string, number | boolean | undefined>();
  /** Events not yet handed over by `drain()` (for incremental transfer to the UI). */
  private pending: Record<string, TrendEvent[]> = {};
  endMs = 0;
  /** Older events are dropped (keeping the value active at the window start). */
  private keepMs: number;
  private lastTrim = 0;

  constructor(signals: string[] = [], keepMs = 10 * 60_000) {
    this.keepMs = keepMs;
    this.setSignals(signals);
  }

  setSignals(signals: string[]): void {
    const next = [...new Set(signals)];
    for (const s of this.signals)
      if (!next.includes(s)) {
        delete this.events[s];
        delete this.pending[s];
        this.last.delete(s);
      }
    for (const s of next) if (!this.events[s]) this.events[s] = [];
    this.signals = next;
  }

  getSignals(): string[] {
    return this.signals;
  }

  clear(): void {
    for (const s of this.signals) this.events[s] = [];
    this.pending = {};
    this.last.clear();
    this.endMs = 0;
    this.lastTrim = 0;
  }

  /** Call after every scan. */
  sample(sim: Simulator, timeMs: number): void {
    this.endMs = timeMs;
    for (const s of this.signals) {
      const v = sim.readSignal(s);
      if (v === undefined) continue;
      if (this.last.has(s) && this.last.get(s) === v) continue;
      this.last.set(s, v);
      const ev: TrendEvent = [timeMs, v];
      this.events[s]!.push(ev);
      (this.pending[s] ??= []).push(ev);
    }
    // Trim old events, keeping the one active at the window start.
    if (timeMs - this.lastTrim >= 1000 || timeMs < this.lastTrim) {
      this.lastTrim = timeMs;
      const limit = timeMs - this.keepMs;
      for (const s of this.signals) {
        const evs = this.events[s]!;
        let i = 0;
        while (i + 1 < evs.length && evs[i + 1]![0] <= limit) i++;
        if (i > 0) evs.splice(0, i);
      }
    }
  }

  /** Events recorded since the previous call. */
  drain(): Record<string, TrendEvent[]> {
    const out = this.pending;
    this.pending = {};
    return out;
  }

  data(): TrendData {
    return { signals: [...this.signals], events: structuredClone(this.events), endMs: this.endMs };
  }
}

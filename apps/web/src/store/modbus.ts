/**
 * Connection to the local Modbus TCP bridge (apps/bridge). The bridge runs on the
 * user's machine; this page talks to it on ws://127.0.0.1 with the pairing code.
 */
import { create } from 'zustand';
import { autoModbusMap, type ModbusEntry, type Project } from '@ladder/core';
import { useProject } from './project.ts';
import { useSim } from './sim.ts';

export type BridgeStatus = 'idle' | 'connecting' | 'connected' | 'error';

interface ModbusState {
  status: BridgeStatus;
  error: string | null;
  requests: number;
  port: number;
  connect(port: number, token: string): void;
  disconnect(): void;
}

let ws: WebSocket | null = null;
let unsubs: (() => void)[] = [];
let lastSent = 0;

/** The map in use: the project's own, or the automatic one. */
export const activeMap = (p: Project): ModbusEntry[] => p.modbus?.map ?? autoModbusMap(p);

function mapMessage(p: Project) {
  const types = new Map(p.tags.map((t) => [t.name, t.type]));
  return {
    type: 'map',
    map: activeMap(p)
      .filter((e) => types.has(e.tag))
      .map((e) => ({
        ...e,
        type: types.get(e.tag) === 'TIMER' || types.get(e.tag) === 'COUNTER' ? 'INT' : types.get(e.tag),
      })),
  };
}

function valuesMessage(p: Project) {
  const values = useSim.getState().snapshot?.values ?? {};
  const out: Record<string, number | boolean> = {};
  for (const e of activeMap(p)) {
    const v = values[e.tag];
    if (typeof v === 'boolean' || typeof v === 'number') out[e.tag] = v;
  }
  return { type: 'values', values: out };
}

export const useModbus = create<ModbusState>((set, get) => ({
  status: 'idle',
  error: null,
  requests: 0,
  port: 8765,
  connect(port, token) {
    get().disconnect();
    set({ status: 'connecting', error: null, port, requests: 0 });
    let socket: WebSocket;
    try {
      socket = new WebSocket(`ws://127.0.0.1:${port}`);
    } catch (e) {
      set({ status: 'error', error: (e as Error).message });
      return;
    }
    ws = socket;
    socket.onopen = () => socket.send(JSON.stringify({ type: 'hello', token: token.trim().toUpperCase() }));
    socket.onmessage = (ev) => {
      const m = JSON.parse(String(ev.data));
      if (m.type === 'welcome') {
        set({ status: 'connected', error: null });
        const send = (obj: unknown) =>
          socket.readyState === WebSocket.OPEN && socket.send(JSON.stringify(obj));
        send(mapMessage(useProject.getState().project));
        send(valuesMessage(useProject.getState().project));
        unsubs = [
          useProject.subscribe((s, prev) => {
            if (s.project.tags !== prev.project.tags || s.project.modbus !== prev.project.modbus)
              send(mapMessage(s.project));
          }),
          useSim.subscribe(() => {
            const now = performance.now();
            if (now - lastSent < 100) return; // 10 updates per second are plenty for an HMI
            lastSent = now;
            send(valuesMessage(useProject.getState().project));
          }),
        ];
      } else if (m.type === 'write' && typeof m.tag === 'string') {
        useSim.getState().setInput(m.tag, m.value);
      } else if (m.type === 'stats') {
        set({ requests: m.requests });
      } else if (m.type === 'error') {
        set({ status: 'error', error: m.code === 'badToken' ? 'badToken' : String(m.code) });
      }
    };
    socket.onerror = () => set({ status: 'error', error: 'unreachable' });
    socket.onclose = () => {
      unsubs.forEach((u) => u());
      unsubs = [];
      if (ws === socket) ws = null;
      if (get().status !== 'error') set({ status: 'idle' });
    };
  },
  disconnect() {
    unsubs.forEach((u) => u());
    unsubs = [];
    ws?.close();
    ws = null;
    set({ status: 'idle' });
  },
}));

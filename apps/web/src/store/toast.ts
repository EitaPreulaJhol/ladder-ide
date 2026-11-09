import { create } from 'zustand';

export type ToastKind = 'info' | 'success' | 'warn' | 'error';

export interface ToastAction {
  label: string;
  run(): void;
}

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  /** Second, smaller line (what exactly changed). */
  detail?: string;
  action?: ToastAction;
  /** Milliseconds on screen (paused while hovered or focused). */
  duration: number;
  /** Called once when the toast leaves, for whatever reason. */
  onClose?(): void;
}

export interface ToastOptions {
  kind?: ToastKind;
  detail?: string;
  action?: ToastAction;
  duration?: number;
  onClose?(): void;
}

/** Older toasts beyond this are dropped. */
const MAX_TOASTS = 4;

export const useToasts = create<{ toasts: Toast[] }>(() => ({ toasts: [] }));

let nextId = 1;

/** Shows a short message in the corner of the page; returns its id. */
export function toast(message: string, opts: ToastOptions = {}): number {
  const kind = opts.kind ?? 'info';
  const t: Toast = {
    id: nextId++,
    kind,
    message,
    detail: opts.detail,
    action: opts.action,
    // Errors and actions stay longer: they need reading or a decision.
    duration: opts.duration ?? (opts.action || kind === 'error' ? 8000 : 4000),
    onClose: opts.onClose,
  };
  const all = [...useToasts.getState().toasts, t];
  const dropped = all.slice(0, Math.max(0, all.length - MAX_TOASTS));
  useToasts.setState({ toasts: all.slice(-MAX_TOASTS) });
  for (const d of dropped) d.onClose?.();
  return t.id;
}

export function dismissToast(id: number): void {
  const { toasts } = useToasts.getState();
  const t = toasts.find((x) => x.id === id);
  if (!t) return;
  useToasts.setState({ toasts: toasts.filter((x) => x.id !== id) });
  t.onClose?.();
}

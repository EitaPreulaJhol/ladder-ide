import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { dismissToast, useToasts, type Toast } from '../store/toast.ts';

const ICON: Record<Toast['kind'], string> = { info: 'ℹ', success: '✓', warn: '⚠', error: '✖' };

/** Stack of toasts at the bottom of the page. Mounted once at the root of the app. */
export function Toasts() {
  const { t } = useTranslation();
  const toasts = useToasts((s) => s.toasts);
  return (
    <section className="toasts" aria-label={t('common.notifications')}>
      {toasts.map((x) => (
        <ToastItem key={x.id} toast={x} />
      ))}
    </section>
  );
}

function ToastItem({ toast }: { toast: Toast }) {
  const { t } = useTranslation();
  const [paused, setPaused] = useState(false);
  // Time left survives pauses (hover / keyboard focus).
  const left = useRef(toast.duration);

  useEffect(() => {
    if (paused) return;
    const start = Date.now();
    const timer = setTimeout(() => dismissToast(toast.id), left.current);
    return () => {
      clearTimeout(timer);
      left.current -= Date.now() - start;
    };
  }, [paused, toast.id]);

  return (
    <div
      className={`toast ${toast.kind}`}
      role={toast.kind === 'error' ? 'alert' : 'status'}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      data-testid="toast"
    >
      <span className="toast-icon" aria-hidden="true">
        {ICON[toast.kind]}
      </span>
      <div className="toast-text">
        <span>{toast.message}</span>
        {toast.detail && <small>{toast.detail}</small>}
      </div>
      {toast.action && (
        <button
          className="toast-action"
          onClick={() => {
            toast.action!.run();
            dismissToast(toast.id);
          }}
          data-testid="toast-action"
        >
          {toast.action.label}
        </button>
      )}
      <button
        className="icon toast-close"
        onClick={() => dismissToast(toast.id)}
        aria-label={t('common.close')}
        title={t('common.close')}
      >
        ×
      </button>
    </div>
  );
}

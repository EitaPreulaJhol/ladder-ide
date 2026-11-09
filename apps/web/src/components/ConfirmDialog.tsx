import { useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { create } from 'zustand';
import { Modal } from './Modal.tsx';

export interface ConfirmOptions {
  /** Destructive action: the confirm button is styled as danger. */
  danger?: boolean;
  /** Label of the confirm button (default: "OK"). */
  confirmLabel?: string;
}

interface Request extends ConfirmOptions {
  id: number;
  message: string;
  resolve(ok: boolean): void;
}

const useConfirm = create<{ queue: Request[] }>(() => ({ queue: [] }));
let nextId = 1;

/**
 * In-page replacement for `window.confirm`: resolves true when the user confirms.
 * Only for what cannot be undone; anything else should run at once with an "Undo" toast.
 */
export function confirmDialog(message: string, options: ConfirmOptions = {}): Promise<boolean> {
  return new Promise((resolve) =>
    useConfirm.setState((s) => ({ queue: [...s.queue, { ...options, id: nextId++, message, resolve }] })),
  );
}

function answer(ok: boolean) {
  const [current, ...rest] = useConfirm.getState().queue;
  if (!current) return;
  useConfirm.setState({ queue: rest });
  current.resolve(ok);
}

/** Renders the pending confirmation, if any. Mounted once at the root of the app. */
export function ConfirmHost() {
  const current = useConfirm((s) => s.queue[0]);
  // A new key per request reopens the modal (focus handling runs again).
  return current ? <ConfirmDialog key={current.id} request={current} /> : null;
}

function ConfirmDialog({ request }: { request: Request }) {
  const { t } = useTranslation();
  const okRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const msgId = useId();
  return (
    <Modal
      role="alertdialog"
      className="confirm"
      onClose={() => answer(false)}
      // Destructive actions start on "Cancel", so an accidental Enter does not confirm them.
      initialFocus={request.danger ? cancelRef : okRef}
      describedBy={msgId}
      testId="confirm-dialog"
    >
      <p id={msgId}>{request.message}</p>
      <div className="modal-actions">
        <button ref={cancelRef} onClick={() => answer(false)} data-testid="confirm-cancel">
          {t('common.cancel')}
        </button>
        <button
          ref={okRef}
          className={request.danger ? 'danger-solid' : 'primary'}
          onClick={() => answer(true)}
          data-testid="confirm-ok"
        >
          {request.confirmLabel ?? t('common.ok')}
        </button>
      </div>
    </Modal>
  );
}

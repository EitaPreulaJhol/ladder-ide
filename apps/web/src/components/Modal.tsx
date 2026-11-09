import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react';

const FOCUSABLE =
  'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

export interface ModalProps {
  title?: ReactNode;
  onClose(): void;
  children: ReactNode;
  /** `alertdialog` for confirmations that interrupt the user. */
  role?: 'dialog' | 'alertdialog';
  className?: string;
  /** Element focused on open (default: the first focusable one). */
  initialFocus?: RefObject<HTMLElement | null>;
  /** Id of the element that describes the dialog (read by screen readers). */
  describedBy?: string;
  testId?: string;
}

/**
 * Dialog over the page: Esc and a click outside close it, Tab stays inside it, the focus
 * returns where it was on close, and keys do not reach the app's global shortcuts
 * (Delete, Ctrl+Z…) while it is open.
 */
export function Modal({
  title,
  onClose,
  children,
  role = 'dialog',
  className,
  initialFocus,
  describedBy,
  testId,
}: ModalProps) {
  const box = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const target = initialFocus?.current ?? box.current?.querySelector<HTMLElement>(FOCUSABLE) ?? box.current;
    target?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
    // Runs once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    // The global shortcuts listen on window: keep the keys inside the dialog.
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'Tab') {
      const items = [...(box.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
      if (!items.length) return e.preventDefault();
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === box.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose} onKeyDown={onKeyDown}>
      <div
        ref={box}
        className={className ? `modal ${className}` : 'modal'}
        onClick={(e) => e.stopPropagation()}
        role={role}
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={describedBy}
        // Clicking plain text keeps the focus inside the dialog.
        tabIndex={-1}
        data-testid={testId}
      >
        {title && <h3 id={titleId}>{title}</h3>}
        {children}
      </div>
    </div>
  );
}

import { Fragment, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useUi } from '../store/ui.ts';
import { Modal } from './Modal.tsx';

const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';

/**
 * Each entry: alternative key combinations (each a list of keys) and what they do.
 * Keys written as `~name` are words translated under `shortcuts.k`.
 */
const GROUPS: { id: string; items: { keys: string[][]; label: string }[] }[] = [
  {
    id: 'general',
    items: [
      { keys: [[MOD, 'Z']], label: 'undo' },
      {
        keys: [
          [MOD, 'Y'],
          [MOD, 'Shift', 'Z'],
        ],
        label: 'redo',
      },
      { keys: [['?']], label: 'help' },
      { keys: [['Esc']], label: 'closeDialog' },
    ],
  },
  {
    id: 'editor',
    items: [
      { keys: [[MOD, 'C']], label: 'copy' },
      { keys: [[MOD, 'V']], label: 'paste' },
      { keys: [['~delete'], ['Backspace']], label: 'deleteSelection' },
      { keys: [['B']], label: 'branch' },
      { keys: [['Esc']], label: 'clearSelection' },
      { keys: [['Shift', '~click']], label: 'rangeSelection' },
      { keys: [['~dblclick']], label: 'renameProgram' },
      { keys: [['Enter']], label: 'confirmField' },
    ],
  },
  {
    id: 'layout',
    items: [
      { keys: [['~delete'], ['Backspace']], label: 'removeItem' },
      { keys: [['← ↑ → ↓']], label: 'moveItem' },
      { keys: [['Shift', '← ↑ → ↓']], label: 'moveItemFine' },
    ],
  },
  {
    id: 'operate',
    items: [
      { keys: [['~space'], ['Enter']], label: 'pressButton' },
      { keys: [['← →']], label: 'trendCursor' },
      { keys: [['Home'], ['End']], label: 'trendEnds' },
    ],
  },
];

/** Opens the shortcuts list with "?" (outside text fields). Mounted once at the root of the app. */
export function ShortcutsHost() {
  const open = useUi((s) => s.shortcutsOpen);
  const setOpen = useUi((s) => s.setShortcutsOpen);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '?' || e.ctrlKey || e.metaKey || e.altKey) return;
      if ((e.target as HTMLElement).closest('input, textarea, select, [contenteditable]')) return;
      e.preventDefault();
      setOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setOpen]);

  return open ? <ShortcutsDialog onClose={() => setOpen(false)} /> : null;
}

function ShortcutsDialog({ onClose }: { onClose(): void }) {
  const { t } = useTranslation();
  const key = (k: string) => (k.startsWith('~') ? t(`shortcuts.k.${k.slice(1)}`) : k);
  return (
    <Modal title={t('shortcuts.title')} onClose={onClose} className="shortcuts" testId="shortcuts">
      <p className="muted small">{t('editor.help')}</p>
      <div className="shortcut-groups">
        {GROUPS.map((g) => (
          <section key={g.id}>
            <h4>{t(`shortcuts.groups.${g.id}`)}</h4>
            <dl>
              {g.items.map((it) => (
                <Fragment key={it.label}>
                  <dt>
                    {it.keys.map((combo, i) => (
                      <Fragment key={i}>
                        {i > 0 && <span className="muted"> / </span>}
                        {combo.map((k, j) => (
                          <Fragment key={j}>
                            {j > 0 && '+'}
                            <kbd>{key(k)}</kbd>
                          </Fragment>
                        ))}
                      </Fragment>
                    ))}
                  </dt>
                  <dd>{t(`shortcuts.items.${it.label}`)}</dd>
                </Fragment>
              ))}
            </dl>
          </section>
        ))}
      </div>
      <div className="modal-actions">
        <button onClick={onClose}>{t('common.close')}</button>
      </div>
    </Modal>
  );
}

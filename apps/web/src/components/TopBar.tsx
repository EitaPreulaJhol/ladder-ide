import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { DIALECTS, DIALECT_IDS, type DialectId } from '@ladder/core';
import { useProject } from '../store/project.ts';
import { useSim } from '../store/sim.ts';
import { downloadText, safeFileName } from '../storage/db.ts';
import { renameProject, showWelcome } from '../session.ts';
import { useUi } from '../store/ui.ts';
import { ShareDialog } from './ShareDialog.tsx';
import { useOnline } from '../pwa.ts';
import { LANGUAGES, setLanguage, type Language } from '../i18n.ts';
import { formatMs } from './editor/format.ts';
import { getThemePref, NEXT_THEME, setThemePref, THEME_ICON, type ThemePref } from '../theme.ts';

const SPEEDS = [0.1, 0.25, 0.5, 1, 2, 5, 10];

export function TopBar({ savedAt }: { savedAt: number | null }) {
  const { t, i18n } = useTranslation();
  const project = useProject((s) => s.project);
  const readOnly = useProject((s) => s.sharedId !== null);
  const canUndo = useProject((s) => s.past.length > 0);
  const canRedo = useProject((s) => s.future.length > 0);
  const { undo, redo, update } = useProject.getState();
  const status = useSim((s) => s.status);
  const speed = useSim((s) => s.speed);
  const snapshot = useSim((s) => s.snapshot);
  const sim = useSim.getState();
  const [sharing, setSharing] = useState(false);
  const [theme, setTheme] = useState<ThemePref>(getThemePref);
  const dialectLocked = project.hardware.family !== 'generic';
  const themeLabel = t('top.theme', { mode: t(`top.theme_${theme}`) });
  const cycleTheme = () => {
    const next = NEXT_THEME[theme];
    setThemePref(next);
    setTheme(next);
  };
  const openShortcuts = () => useUi.getState().setShortcutsOpen(true);
  const exportJson = () =>
    downloadText(`${safeFileName(project.meta.name)}.ladder.json`, JSON.stringify(project, null, 2));
  const online = useOnline();

  return (
    <header className="topbar">
      <button className="brand" onClick={showWelcome} title={t('welcome.home')} data-testid="home">
        <img src="/favicon.svg" alt="" width={22} height={22} />
        <span>{t('app.title')}</span>
      </button>
      <input
        className="project-name"
        key={project.id + project.meta.name}
        defaultValue={project.meta.name}
        readOnly={readOnly}
        aria-label={t('top.projectName')}
        onBlur={(e) => void renameProject(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      {!readOnly && (
        <>
          <button className="icon" onClick={undo} disabled={!canUndo} title={t('top.undo')}>
            ↶
          </button>
          <button className="icon" onClick={redo} disabled={!canRedo} title={t('top.redo')}>
            ↷
          </button>
        </>
      )}
      <label className="dialect">
        <span>{t('top.dialect')}</span>
        <select
          value={project.dialect}
          disabled={readOnly || dialectLocked}
          title={dialectLocked ? t('top.dialectLocked') : undefined}
          onChange={(e) => update((d) => void (d.dialect = e.target.value as DialectId))}
          data-testid="dialect"
        >
          {DIALECT_IDS.map((id) => (
            <option key={id} value={id}>
              {DIALECTS[id].name}
            </option>
          ))}
        </select>
      </label>

      <div className="sim-controls">
        <span className={`plc-status ${status}`} data-testid="plc-status">
          {status === 'running'
            ? t('top.statusRun')
            : status === 'paused'
              ? t('top.statusPause')
              : t('top.statusStop')}
        </span>
        {status === 'running' ? (
          <button onClick={sim.pause} title={t('top.pause')}>
            ❚❚
          </button>
        ) : (
          <button className="run" onClick={sim.run} title={t('top.run')} data-testid="run">
            ▶ {t('top.run')}
          </button>
        )}
        <button onClick={sim.stop} disabled={status === 'stopped'} title={t('top.stop')} data-testid="stop">
          ■
        </button>
        <button onClick={sim.step} title={t('top.step')}>
          ⏭
        </button>
        <select value={speed} onChange={(e) => sim.setSpeed(Number(e.target.value))} title={t('top.speed')}>
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>
        <span className="muted small scan-info">
          {snapshot ? t('top.scanInfo', { scans: snapshot.scanCount, time: formatMs(snapshot.timeMs) }) : ''}
        </span>
      </div>

      <span className="grow" />
      {savedAt && !readOnly && (
        <span className="muted small hide-narrow" title={t('top.saved')}>
          ✓ <span className="saved-label">{t('top.saved')}</span>
        </span>
      )}
      <span className="topbar-extras">
        <select
          className="lang-select"
          value={i18n.language}
          onChange={(e) => setLanguage(e.target.value as Language)}
          aria-label={t('top.language')}
          title={t('top.language')}
          data-testid="language"
        >
          {LANGUAGES.map((l) => (
            <option key={l.id} value={l.id}>
              {l.short}
            </option>
          ))}
        </select>
        <button
          className="icon theme-toggle"
          data-testid="theme-toggle"
          title={themeLabel}
          aria-label={themeLabel}
          onClick={cycleTheme}
        >
          {THEME_ICON[theme]}
        </button>
        <button
          className="icon"
          onClick={openShortcuts}
          title={t('shortcuts.open')}
          aria-label={t('shortcuts.open')}
        >
          ⌨
        </button>
        <button onClick={exportJson} title={t('top.export')} data-testid="export">
          ⤓ <span className="label-wide">{t('top.export')}</span>
        </button>
      </span>
      <MoreMenu>
        <div className="menu-label" id="more-lang">
          {t('top.language')}
        </div>
        <div role="group" aria-labelledby="more-lang">
          {LANGUAGES.map((l) => (
            <button
              key={l.id}
              role="menuitemradio"
              aria-checked={i18n.language === l.id}
              onClick={() => setLanguage(l.id)}
              data-close
            >
              {l.label}
            </button>
          ))}
        </div>
        <hr />
        <button role="menuitem" onClick={cycleTheme}>
          {THEME_ICON[theme]} {themeLabel}
        </button>
        <button role="menuitem" onClick={openShortcuts} data-close>
          ⌨ {t('shortcuts.open')}
        </button>
        <button role="menuitem" onClick={exportJson} data-close>
          ⤓ {t('top.exportJson')}
        </button>
      </MoreMenu>
      {!online && (
        <span className="offline-badge" title={t('pwa.offlineHint')} data-testid="offline">
          {t('pwa.offline')}
        </span>
      )}
      <button
        className="primary"
        onClick={() => setSharing(true)}
        data-testid="share"
        disabled={!online}
        title={online ? t('top.share') : t('pwa.shareOffline')}
      >
        🔗 <span className="label-wide">{t('top.share')}</span>
      </button>
      {sharing && <ShareDialog onClose={() => setSharing(false)} />}
    </header>
  );
}

/**
 * "⋯" menu with the less used top bar actions; shown only where the bar is too narrow
 * for them (see .topbar-extras in styles.css). Fixed position: the bar clips overflow.
 */
function MoreMenu({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const close = () => {
    setPos(null);
    button.current?.focus();
  };

  useEffect(() => {
    if (!pos) return;
    menu.current?.querySelector<HTMLElement>('button')?.focus();
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!menu.current?.contains(target) && !button.current?.contains(target)) setPos(null);
    };
    const onResize = () => setPos(null);
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('resize', onResize);
    };
  }, [pos]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation(); // not for the editor shortcuts
    const items = [...(menu.current?.querySelectorAll<HTMLElement>('button') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowDown') items[(i + 1) % items.length]?.focus();
    else if (e.key === 'ArrowUp') items[(i - 1 + items.length) % items.length]?.focus();
    else if (e.key === 'Tab') setPos(null);
    else return;
    if (e.key !== 'Tab') e.preventDefault();
  };

  return (
    <>
      <button
        ref={button}
        className="icon more-button"
        aria-haspopup="menu"
        aria-expanded={!!pos}
        title={t('common.more')}
        aria-label={t('common.more')}
        onClick={() => {
          if (pos) return setPos(null);
          const r = button.current!.getBoundingClientRect();
          setPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
        }}
        data-testid="more-menu"
      >
        ⋯
      </button>
      {pos && (
        <div
          ref={menu}
          className="menu"
          role="menu"
          style={pos}
          onKeyDown={onKeyDown}
          // Items marked data-close close the menu after their action.
          onClick={(e) => (e.target as HTMLElement).closest('[data-close]') && close()}
        >
          {children}
        </div>
      )}
    </>
  );
}

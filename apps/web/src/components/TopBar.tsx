import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DIALECTS, DIALECT_IDS, type DialectId } from '@ladder/core';
import { useProject } from '../store/project.ts';
import { useSim } from '../store/sim.ts';
import { downloadText, safeFileName } from '../storage/db.ts';
import { ShareDialog } from './ShareDialog.tsx';
import { formatMs } from './editor/format.ts';
import { getThemePref, NEXT_THEME, setThemePref, type ThemePref } from '../theme.ts';

const THEME_ICON: Record<ThemePref, string> = { system: '◐', light: '☀', dark: '☾' };

const SPEEDS = [0.1, 0.25, 0.5, 1, 2, 5, 10];

export function TopBar({ savedAt }: { savedAt: number | null }) {
  const { t } = useTranslation();
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

  return (
    <header className="topbar">
      <div className="brand" title={t('app.tagline')}>
        <img src="/favicon.svg" alt="" width={22} height={22} />
        <span>{t('app.title')}</span>
      </div>
      <input
        className="project-name"
        key={project.id + project.meta.name}
        defaultValue={project.meta.name}
        readOnly={readOnly}
        aria-label={t('top.projectName')}
        onBlur={(e) =>
          e.target.value !== project.meta.name &&
          update((d) => void (d.meta.name = e.target.value || 'Sem nome'))
        }
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
      {savedAt && !readOnly && <span className="muted small hide-narrow">✓ {t('top.saved')}</span>}
      <button
        className="icon theme-toggle"
        data-testid="theme-toggle"
        title={t('top.theme', { mode: t(`top.theme_${theme}`) })}
        aria-label={t('top.theme', { mode: t(`top.theme_${theme}`) })}
        onClick={() => {
          const next = NEXT_THEME[theme];
          setThemePref(next);
          setTheme(next);
        }}
      >
        {THEME_ICON[theme]}
      </button>
      <button
        onClick={() =>
          downloadText(`${safeFileName(project.meta.name)}.ladder.json`, JSON.stringify(project, null, 2))
        }
        title={t('top.export')}
      >
        ⤓ <span className="label-wide">{t('top.export')}</span>
      </button>
      <button className="primary" onClick={() => setSharing(true)} data-testid="share" title={t('top.share')}>
        🔗 <span className="label-wide">{t('top.share')}</span>
      </button>
      {sharing && <ShareDialog onClose={() => setSharing(false)} />}
    </header>
  );
}

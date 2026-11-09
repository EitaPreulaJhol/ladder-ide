import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCurrentProgram, useProject } from '../../store/project.ts';
import { useSim } from '../../store/sim.ts';
import { Palette } from './Palette.tsx';
import { ProgramTabs } from './ProgramTabs.tsx';
import { RungView } from './RungView.tsx';
import { CW, PAD } from './format.ts';
import { explainMarks, useExplanation } from '../xref/ExplainPanel.tsx';
import { GrafcetEditor } from './GrafcetEditor.tsx';
import { useUi } from '../../store/ui.ts';

export function LadderEditor() {
  const { t } = useTranslation();
  const program = useCurrentProgram();
  const project = useProject((s) => s.project);
  const selection = useProject((s) => s.selection);
  const cursor = useProject((s) => s.cursor);
  const sharedReadOnly = useProject((s) => s.sharedId !== null);
  const grafcet = program.generatedBy
    ? project.grafcets?.find((g) => g.id === program.generatedBy)
    : undefined;
  const [showLadder, setShowLadder] = useState(false);
  // A program generated from a GRAFCET is edited through the GRAFCET only.
  const readOnly = sharedReadOnly || !!grafcet;
  const actions = useProject.getState();
  const snapshot = useSim((s) => s.snapshot);
  const status = useSim((s) => s.status);
  const live = status !== 'stopped';
  const explanation = useExplanation();
  const marks = explainMarks(explanation);
  const scroller = useRef<HTMLDivElement>(null);
  const [minCols, setMinCols] = useState(8);

  // Rungs fill the available width (at least 6 cells).
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() =>
      setMinCols(Math.max(6, Math.floor((el.clientWidth - 70 - PAD * 2) / CW))),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, [grafcet, showLadder]);

  const hasNode = !!selection?.nodeId;
  return (
    <div className="editor">
      <ProgramTabs />
      {grafcet && (
        <div className="grafcet-switch" role="tablist">
          <button
            role="tab"
            aria-selected={!showLadder}
            className={!showLadder ? 'active' : ''}
            onClick={() => setShowLadder(false)}
            data-testid="show-grafcet"
          >
            {t('grafcet.view')}
          </button>
          <button
            role="tab"
            aria-selected={showLadder}
            className={showLadder ? 'active' : ''}
            onClick={() => setShowLadder(true)}
            data-testid="show-ladder"
          >
            {t('grafcet.generatedLadder')}
          </button>
          {showLadder && <span className="muted small">{t('grafcet.readOnlyNote')}</span>}
        </div>
      )}
      {grafcet && !showLadder ? (
        <div className="rungs">
          <GrafcetEditor grafcet={grafcet} />
        </div>
      ) : (
        <>
          {!readOnly && <Palette />}
          {!readOnly && (
            <div className="editor-toolbar">
              <button onClick={() => actions.addRung(selection?.rungId)} data-testid="add-rung">
                ＋ {t('editor.newRung')}
              </button>
              <button
                disabled={!hasNode}
                title={t('editor.branchHint')}
                onClick={actions.branchAroundSelection}
                data-testid="branch"
              >
                ⑂ {t('editor.branch')}
              </button>
              <button
                disabled={!hasNode}
                title={t('editor.addBranchHint')}
                onClick={actions.addBranchToSelection}
              >
                ＋⑂ {t('editor.addBranch')}
              </button>
              <span className="sep" />
              <button disabled={!selection} onClick={actions.deleteSelection} title={t('editor.delete')}>
                🗑
              </button>
              <button disabled={!selection} onClick={actions.copy} title={t('editor.copy')}>
                ⧉
              </button>
              <button onClick={actions.paste} title={t('editor.paste')}>
                📋
              </button>
              <span className="sep" />
              <button
                disabled={!selection}
                onClick={() => selection && actions.moveRung(selection.rungId, -1)}
                title={t('editor.moveUp')}
              >
                ↑
              </button>
              <button
                disabled={!selection}
                onClick={() => selection && actions.moveRung(selection.rungId, 1)}
                title={t('editor.moveDown')}
              >
                ↓
              </button>
              <button
                disabled={!selection}
                onClick={() => selection && actions.duplicateRung(selection.rungId)}
                title={t('editor.duplicate')}
              >
                ⎘
              </button>
              <span className="grow" />
              <span className="muted small editor-help" title={t('editor.help')}>
                {t('editor.help')}
              </span>
              <button
                className="icon"
                onClick={() => useUi.getState().setShortcutsOpen(true)}
                title={t('shortcuts.open')}
                aria-label={t('shortcuts.open')}
                data-testid="open-shortcuts"
              >
                ⌨
              </button>
            </div>
          )}
          <div className="rungs" ref={scroller} onClick={() => actions.select(null)}>
            {program.rungs.map((r, i) => (
              <RungView
                key={r.id}
                rung={r}
                index={i}
                project={project}
                snapshot={snapshot}
                live={live}
                selection={selection}
                cursor={cursor}
                readOnly={readOnly}
                minCols={minCols}
                marks={explanation?.paths[0]?.ref.rungId === r.id ? marks : undefined}
              />
            ))}
            {!readOnly && (
              <button className="add-rung-end" onClick={(e) => (e.stopPropagation(), actions.addRung())}>
                ＋ {t('editor.newRung')}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** Global editor shortcuts (ignored while typing in inputs). */
export function useEditorShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, select, [contenteditable]')) return;
      const s = useProject.getState();
      // Nothing to edit on the welcome page (and maybe no project loaded yet).
      if (!s.project || useUi.getState().welcome || s.sharedId !== null) return;
      const current = s.project.programs.find((p) => p.id === s.programId) ?? s.project.programs[0];
      const generated = !!current?.generatedBy;
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key.toLowerCase() === 'z' && !e.shiftKey) s.undo();
      else if (ctrl && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) s.redo();
      else if (ctrl && e.key.toLowerCase() === 'c') s.copy();
      else if (ctrl && e.key.toLowerCase() === 'v' && !generated) s.paste();
      else if (s.view !== 'editor' || generated) return;
      else if (e.key === 'Delete' || e.key === 'Backspace') s.deleteSelection();
      else if (e.key.toLowerCase() === 'b' && !ctrl) s.branchAroundSelection();
      else if (e.key === 'Escape') {
        s.select(null);
        s.setCursor(null);
      } else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

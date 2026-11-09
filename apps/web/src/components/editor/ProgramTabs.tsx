import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Program, Series } from '@ladder/core';
import { useProject } from '../../store/project.ts';
import { runWithUndo } from '../../store/undoable.ts';

/** Program list: main programs run every scan in this order; subroutines run only when called. */
export function ProgramTabs() {
  const { t } = useTranslation();
  const programs = useProject((s) => s.project.programs);
  const programId = useProject((s) => s.programId);
  const readOnly = useProject((s) => s.sharedId !== null);
  const a = useProject.getState();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Name taken by another program, checked while typing. */
  const taken = (id: string, name: string) => programs.some((p) => p.id !== id && p.name === name.trim());
  const current = programs.find((p) => p.id === programId) ?? programs[0]!;
  const isSub = current.kind === 'sub';

  const remove = () => {
    const { id, name } = current;
    const calls = countCalls(programs, name);
    runWithUndo(
      () => a.deleteProgram(id),
      {
        message: t('programs.deleted', { name }),
        // Deleting a called subroutine leaves its CALLs dangling: say so right away.
        detail: calls ? t('programs.deletedCalled', { count: calls }) : undefined,
      },
      { afterUndo: () => a.setProgram(id) },
    );
  };

  return (
    <div className="program-tabs" role="tablist" aria-label={t('programs.title')}>
      {programs.map((p) => {
        const sub = p.kind === 'sub';
        return renaming === p.id ? (
          <input
            key={p.id}
            className="program-rename"
            autoFocus
            defaultValue={p.name}
            aria-label={t('programs.rename')}
            aria-invalid={!!error}
            onChange={(e) => setError(taken(p.id, e.target.value) ? t('programs.nameTaken') : null)}
            onBlur={(e) => {
              // A blank name cancels; a taken one is refused (the program keeps its old name).
              if (!e.target.value.trim()) setError(null);
              else if (!a.renameProgram(p.id, e.target.value)) setError(t('programs.nameTaken'));
              else setError(null);
              setRenaming(null);
            }}
            onKeyDown={(e) => {
              // Enter on a taken name keeps the field open to fix it.
              if (e.key === 'Enter' && !taken(p.id, e.currentTarget.value)) e.currentTarget.blur();
              if (e.key === 'Escape') {
                setError(null);
                setRenaming(null);
              }
            }}
          />
        ) : (
          <button
            key={p.id}
            role="tab"
            aria-selected={p.id === current.id}
            className={`program-tab${p.id === current.id ? ' active' : ''}${sub ? ' sub' : ''}`}
            onClick={() => a.setProgram(p.id)}
            onDoubleClick={() => !readOnly && !p.generatedBy && setRenaming(p.id)}
            title={
              p.generatedBy
                ? t('programs.grafcetHint')
                : sub
                  ? t('programs.subHint', { n: countCalls(programs, p.name) })
                  : t('programs.mainHint')
            }
            data-testid={`program-tab-${p.name}`}
          >
            <span className="program-kind">{p.generatedBy ? '⧉' : sub ? 'ƒ' : '▶'}</span> {p.name}
          </button>
        );
      })}
      {!readOnly && (
        <>
          <button
            className="program-add"
            onClick={() => a.addProgram('sub', t('programs.newSubName'))}
            data-testid="add-sub"
          >
            ＋ ƒ {t('programs.newSub')}
          </button>
          <button className="program-add" onClick={() => a.addProgram('main', t('programs.newMainName'))}>
            ＋ ▶ {t('programs.newMain')}
          </button>
          <button className="program-add" onClick={() => a.addGrafcet('GRAFCET')} data-testid="add-grafcet">
            ＋ ⧉ GRAFCET
          </button>
          <span className="grow" />
          <span className="program-actions">
            <button
              className="icon"
              title={t('programs.rename')}
              disabled={!!current.generatedBy}
              onClick={() => setRenaming(current.id)}
            >
              ✎
            </button>
            <button
              className="icon"
              title={isSub ? t('programs.makeMain') : t('programs.makeSub')}
              disabled={!!current.generatedBy}
              onClick={() => a.setProgramKind(current.id, isSub ? 'main' : 'sub')}
              data-testid="toggle-program-kind"
            >
              {isSub ? '▶' : 'ƒ'}
            </button>
            <button
              className="icon"
              title={t('programs.moveLeft')}
              onClick={() => a.moveProgram(current.id, -1)}
            >
              ◀
            </button>
            <button
              className="icon"
              title={t('programs.moveRight')}
              onClick={() => a.moveProgram(current.id, 1)}
            >
              ▶
            </button>
            <button
              className="icon danger"
              title={t('programs.delete')}
              disabled={programs.length <= 1}
              onClick={remove}
              data-testid="delete-program"
            >
              🗑
            </button>
          </span>
        </>
      )}
      {error && <span className="error-text small">{error}</span>}
    </div>
  );
}

/** CALL instructions targeting a program (anywhere in the tree). */
function countCalls(programs: Program[], name: string): number {
  let n = 0;
  const walk = (s: Series) => {
    for (const node of s) {
      if (node.kind === 'par') node.branches.forEach(walk);
      else if (node.instr === 'CALL' && node.operands[0]?.trim() === name) n++;
    }
  };
  for (const g of programs) for (const r of g.rungs) walk(r.body);
  return n;
}

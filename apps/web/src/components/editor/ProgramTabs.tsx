import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Program, Series } from '@ladder/core';
import { useProject } from '../../store/project.ts';

/** Program list: main programs run every scan in this order; subroutines run only when called. */
export function ProgramTabs() {
  const { t } = useTranslation();
  const programs = useProject((s) => s.project.programs);
  const programId = useProject((s) => s.programId);
  const readOnly = useProject((s) => s.sharedId !== null);
  const a = useProject.getState();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = programs.find((p) => p.id === programId) ?? programs[0]!;
  const isSub = current.kind === 'sub';

  const remove = () => {
    const calls = countCalls(programs, current.name);
    const msg = calls
      ? t('programs.deleteCalled', { name: current.name, n: calls })
      : t('programs.deleteConfirm', { name: current.name });
    if (confirm(msg)) a.deleteProgram(current.id);
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
            onBlur={(e) => {
              if (!a.renameProgram(p.id, e.target.value)) setError(t('programs.nameTaken'));
              else setError(null);
              setRenaming(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') setRenaming(null);
            }}
          />
        ) : (
          <button
            key={p.id}
            role="tab"
            aria-selected={p.id === current.id}
            className={`program-tab${p.id === current.id ? ' active' : ''}${sub ? ' sub' : ''}`}
            onClick={() => a.setProgram(p.id)}
            onDoubleClick={() => !readOnly && setRenaming(p.id)}
            title={sub ? t('programs.subHint', { n: countCalls(programs, p.name) }) : t('programs.mainHint')}
            data-testid={`program-tab-${p.name}`}
          >
            <span className="program-kind">{sub ? 'ƒ' : '▶'}</span> {p.name}
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
          <span className="grow" />
          <span className="program-actions">
            <button className="icon" title={t('programs.rename')} onClick={() => setRenaming(current.id)}>
              ✎
            </button>
            <button
              className="icon"
              title={isSub ? t('programs.makeMain') : t('programs.makeSub')}
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

import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  forEachElement,
  layoutRung,
  locate,
  type InstructionId,
  type Project,
  type Rung,
  type SimSnapshot,
} from '@ladder/core';
import { useProject, type Cursor, type Selection } from '../../store/project.ts';
import { Glyph } from './Glyph.tsx';
import { CH, CW, PAD, WY } from './format.ts';
import { dragPayload, setDragPayload } from './dnd.ts';

interface Props {
  rung: Rung;
  index: number;
  project: Project;
  snapshot: SimSnapshot | null;
  live: boolean;
  selection: Selection | null;
  cursor: Cursor | null;
  readOnly: boolean;
  minCols: number;
}

function selectedIds(rung: Rung, sel: Selection | null): Set<string> {
  const out = new Set<string>();
  if (!sel || sel.rungId !== rung.id || !sel.nodeId) return out;
  const a = locate(rung, sel.nodeId);
  if (!a) return out;
  let from = a.index;
  let to = a.index;
  if (sel.toNodeId) {
    const b = locate(rung, sel.toNodeId);
    if (b && b.series === a.series) {
      from = Math.min(a.index, b.index);
      to = Math.max(a.index, b.index);
    }
  }
  const nodes = a.series.slice(from, to + 1);
  nodes.forEach((n) => out.add(n.id));
  forEachElement(nodes, (el) => out.add(el.id));
  return out;
}

export const RungView = memo(function RungView({
  rung,
  index,
  project,
  snapshot,
  live,
  selection,
  cursor,
  readOnly,
  minCols,
}: Props) {
  const { t } = useTranslation();
  const layout = useMemo(() => layoutRung(rung, minCols), [rung, minCols]);
  const select = useProject((s) => s.select);
  const setCursor = useProject((s) => s.setCursor);
  const insertInstruction = useProject((s) => s.insertInstruction);
  const moveNodeTo = useProject((s) => s.moveNodeTo);
  const removeBranch = useProject((s) => s.removeBranch);
  const setRungComment = useProject((s) => s.setRungComment);
  const [hoverSlot, setHoverSlot] = useState<string | null>(null);

  const trace = live ? snapshot?.trace : undefined;
  const values = snapshot?.values;
  const power = (src: string) => (trace ? (src === 'rail' ? true : (trace[src]?.[1] ?? false)) : false);
  const sel = selectedIds(rung, selection);
  const rungSelected = selection?.rungId === rung.id && !selection.nodeId;
  const width = PAD * 2 + layout.cols * CW;
  const height = layout.rows * CH + 4;
  const y = (row: number) => row * CH + WY;
  const x = (col: number) => PAD + col * CW;

  const dropAt = (slot: Cursor) => {
    const p = dragPayload();
    if (!p || readOnly) return;
    if (p.kind === 'instr') insertInstruction(p.instr as InstructionId, slot);
    else moveNodeTo(p.rungId, p.nodeId, slot);
    setDragPayload(null);
  };

  return (
    <div className={`rung${rungSelected ? ' selected' : ''}`} data-rung={index + 1}>
      <button className="rung-gutter" onClick={() => select({ rungId: rung.id })} title={`Rung ${index + 1}`}>
        {String(index + 1).padStart(3, '0')}
      </button>
      <div className="rung-main">
        <input
          key={rung.comment ?? ''}
          className="rung-comment"
          defaultValue={rung.comment ?? ''}
          placeholder={readOnly ? '' : t('editor.comment')}
          readOnly={readOnly}
          onBlur={(e) => e.target.value !== (rung.comment ?? '') && setRungComment(rung.id, e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        <div className="rung-canvas" style={{ width, height }}>
          <svg className="rung-wires" width={width} height={height}>
            <line className={trace ? 'rail on' : 'rail'} x1={PAD - 2} y1={2} x2={PAD - 2} y2={height - 2} />
            <line
              className={trace ? 'rail on' : 'rail'}
              x1={width - PAD + 2}
              y1={2}
              x2={width - PAD + 2}
              y2={height - 2}
            />
            {layout.hwires.map((w, i) => (
              <line
                key={'h' + i}
                className={power(w.src) ? 'w on' : 'w'}
                x1={x(w.x1)}
                y1={y(w.row)}
                x2={x(w.x2)}
                y2={y(w.row)}
              />
            ))}
            {layout.vwires.map((w, i) => (
              <line
                key={'v' + i}
                className={power(w.src) ? 'w on' : 'w'}
                x1={x(w.x)}
                y1={y(w.row1)}
                x2={x(w.x)}
                y2={y(w.row2)}
              />
            ))}
          </svg>

          {layout.items.map(({ el, col, row }) => (
            <div
              key={el.id}
              className={`cell${sel.has(el.id) ? ' selected' : ''}`}
              style={{ left: x(col), top: row * CH }}
              draggable={!readOnly}
              data-testid={`el-${el.instr}-${el.operands[0] ?? ''}`}
              title={el.operands.join(', ')}
              onDragStart={(e) => {
                e.dataTransfer.setData('application/x-ladder-node', el.id);
                e.dataTransfer.effectAllowed = 'move';
                setDragPayload({ kind: 'node', rungId: rung.id, nodeId: el.id });
              }}
              onDragEnd={() => setDragPayload(null)}
              onClick={(e) => {
                e.stopPropagation();
                if (e.shiftKey && selection?.rungId === rung.id && selection.nodeId)
                  select({ rungId: rung.id, nodeId: selection.nodeId, toNodeId: el.id });
                else select({ rungId: rung.id, nodeId: el.id });
                setCursor(null);
              }}
              onDoubleClick={() => {
                const input = document.querySelector<HTMLInputElement>('.props input[data-operand="0"]');
                input?.focus();
                input?.select();
              }}
            >
              <Glyph el={el} project={project} power={trace?.[el.id]} values={values} />
            </div>
          ))}

          {layout.emptyBranches.map((b) => (
            <div
              key={`${b.parallel}/${b.branch}`}
              className="empty-branch"
              style={{ left: x(b.x1) + (b.x2 - b.x1) * CW * 0.5 - 12, top: y(b.row) - 9 }}
            >
              {!readOnly && (
                <button
                  title={t('editor.removeBranch')}
                  onClick={() => removeBranch(rung.id, b.parallel, b.branch)}
                >
                  ×
                </button>
              )}
            </div>
          ))}

          {!readOnly &&
            layout.slots.map((s) => {
              const key = `${s.container}/${s.branch}/${s.index}`;
              const isCursor =
                cursor?.rungId === rung.id &&
                cursor.container === s.container &&
                cursor.branch === s.branch &&
                cursor.index === s.index;
              const slot: Cursor = {
                rungId: rung.id,
                container: s.container,
                branch: s.branch,
                index: s.index,
              };
              return (
                <div
                  key={key}
                  className={`slot${isCursor ? ' cursor' : ''}${hoverSlot === key ? ' over' : ''}`}
                  style={{ left: x(s.x) - 8, top: s.row * CH + WY - 20 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setCursor(slot);
                    select({ rungId: rung.id });
                  }}
                  onDragOver={(e) => {
                    if (!dragPayload()) return;
                    e.preventDefault();
                    setHoverSlot(key);
                  }}
                  onDragLeave={() => setHoverSlot(null)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setHoverSlot(null);
                    dropAt(slot);
                  }}
                />
              );
            })}
          {rung.body.length === 0 && <div className="rung-empty-hint">{t('editor.emptyRung')}</div>}
        </div>
      </div>
    </div>
  );
});

import { useTranslation } from 'react-i18next';
import {
  findNode,
  getDialect,
  INSTRUCTIONS,
  INSTRUCTION_IDS,
  tagAddress,
  type Element,
  type InstructionId,
} from '@ladder/core';
import { useCurrentProgram, useProject } from '../../store/project.ts';
import { useSim } from '../../store/sim.ts';
import { formatValue, liveValue, tagOf } from './format.ts';

const EXAMPLE_ADDR = { iec: '%IX0.0', siemens: 'I0.0', ab: 'I:1/0', schneider: '%I0.0', haiwell: 'X0' };

export function Properties() {
  const { t } = useTranslation();
  const project = useProject((s) => s.project);
  const selection = useProject((s) => s.selection);
  const readOnly = useProject((s) => s.sharedId !== null);
  const setOperand = useProject((s) => s.setOperand);
  const setInstruction = useProject((s) => s.setInstruction);
  const program = useCurrentProgram();
  const values = useSim((s) => s.snapshot?.values);
  const dialect = getDialect(project.dialect);

  const rungIndex = selection ? program.rungs.findIndex((r) => r.id === selection.rungId) : -1;
  const rung = rungIndex >= 0 ? program.rungs[rungIndex] : undefined;
  const node = rung && selection?.nodeId ? findNode(rung, selection.nodeId) : null;

  if (!rung) return <div className="props muted">{t('props.nothing')}</div>;
  if (!node || node.kind !== 'el')
    return <div className="props muted">{t('props.rungSelected', { n: rungIndex + 1 })}</div>;
  const el = node as Element;
  const info = INSTRUCTIONS[el.instr];
  const sameCategory = INSTRUCTION_IDS.filter((id) => INSTRUCTIONS[id].category === info.category);

  return (
    <div className="props">
      <label className="field">
        <span>{t('props.instruction')}</span>
        <select
          value={el.instr}
          disabled={readOnly}
          onChange={(e) => setInstruction(rung.id, el.id, e.target.value as InstructionId)}
        >
          {sameCategory.map((id) => (
            <option key={id} value={id}>
              {dialect.mnemonic(id)} ({id})
            </option>
          ))}
        </select>
      </label>
      <p className="help">{t(`instr.${el.instr}`)}</p>
      <div className="props-title">{t('props.operands')}</div>
      {info.operands.map((spec, i) => {
        const tag = tagOf(project, el.operands[i]);
        const live = liveValue(values, el.operands[i]);
        return (
          <label key={`${el.id}-${i}-${el.operands[i]}`} className="field">
            <span>{t(`operand.${spec.label}`)}</span>
            <input
              data-operand={i}
              list="tag-names"
              defaultValue={el.operands[i] ?? ''}
              readOnly={readOnly}
              spellCheck={false}
              placeholder={t('props.hintOperand', { example: EXAMPLE_ADDR[project.dialect] })}
              onBlur={(e) => setOperand(rung.id, el.id, i, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  setOperand(rung.id, el.id, i, (e.target as HTMLInputElement).value);
                  const next = document.querySelector<HTMLInputElement>(
                    `.props input[data-operand="${i + 1}"]`,
                  );
                  if (next) next.focus();
                  else (e.target as HTMLInputElement).blur();
                }
                if (e.key === 'Escape') (e.target as HTMLInputElement).blur();
              }}
            />
            <small className="muted">
              {tag && t('props.tagInfo', { type: tag.type, address: tagAddress(tag, project) || '—' })}
              {tag?.comment ? ` · ${tag.comment}` : ''}
              {live !== undefined && typeof live !== 'object' && tag
                ? ` · ${t('props.live')}: ${formatValue(live)}`
                : ''}
            </small>
          </label>
        );
      })}
      <p className="help muted">{t('props.newTagCreated')}</p>
      <datalist id="tag-names">
        {project.tags.map((tg) => (
          <option key={tg.name} value={tg.name}>
            {tg.type} {tagAddress(tg, project)} {tg.comment ?? ''}
          </option>
        ))}
      </datalist>
    </div>
  );
}

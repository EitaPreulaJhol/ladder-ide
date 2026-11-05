import { useTranslation } from 'react-i18next';
import {
  CATEGORY_ORDER,
  getDialect,
  getFamily,
  INSTRUCTIONS,
  INSTRUCTION_IDS,
  type InstructionId,
} from '@ladder/core';
import { useProject } from '../../store/project.ts';
import { setDragPayload } from './dnd.ts';

export function Palette() {
  const { t } = useTranslation();
  const dialect = useProject((s) => getDialect(s.project.dialect));
  const insert = useProject((s) => s.insertInstruction);
  const readOnly = useProject((s) => s.sharedId !== null);
  const family = useProject((s) => getFamily(s.project.hardware.family));
  return (
    <div className="palette">
      {CATEGORY_ORDER.map((cat) => (
        <div key={cat} className="palette-group">
          <div className="palette-title">{t(`cat.${cat}`)}</div>
          <div className="palette-items">
            {INSTRUCTION_IDS.filter((id) => INSTRUCTIONS[id].category === cat).map((id: InstructionId) => {
              const unsupported = !!family?.unsupported.includes(id);
              return (
                <button
                  key={id}
                  className={unsupported ? 'palette-item unsupported' : 'palette-item'}
                  draggable={!readOnly && !unsupported}
                  disabled={readOnly || unsupported}
                  title={`${dialect.mnemonic(id)} — ${unsupported ? t('editor.unsupported', { family: family!.name }) : t(`instr.${id}`)}`}
                  data-testid={`palette-${id}`}
                  onClick={() => insert(id)}
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/x-ladder-instr', id);
                    e.dataTransfer.effectAllowed = 'copy';
                    setDragPayload({ kind: 'instr', instr: id });
                  }}
                  onDragEnd={() => setDragPayload(null)}
                >
                  {dialect.mnemonic(id)}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

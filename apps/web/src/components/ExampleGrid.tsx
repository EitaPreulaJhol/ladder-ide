import { useTranslation } from 'react-i18next';
import { EXAMPLES } from '@ladder/core';

/** Built-in examples and exercises (scenarios with a virtual plant and automatic grading). */
export function ExampleGrid({ onOpen, testIdPrefix }: { onOpen(id: string): void; testIdPrefix: string }) {
  const { t } = useTranslation();
  return (
    <div className="example-grid">
      {EXAMPLES.map((ex) => {
        const sc = ex.id.startsWith('scenario:') ? ex.id.slice(9) : null;
        return (
          <div key={ex.id} className="scenario-card">
            <strong>{sc ? t(`plant.${sc}.title`) : t(`projects.ex.${ex.id}`)}</strong>
            {sc && <p className="muted small">{t(`plant.${sc}.summary`)}</p>}
            <button data-testid={`${testIdPrefix}${ex.id}`} onClick={() => onOpen(ex.id)}>
              {t('projects.useExample')}
            </button>
          </div>
        );
      })}
    </div>
  );
}

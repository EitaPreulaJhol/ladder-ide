import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { applyScenario, getScenario, SCENARIOS } from '@ladder/core';
import { useProject } from '../store/project.ts';
import { useSim } from '../store/sim.ts';
import { MotorPlant } from './plants/MotorPlant.tsx';
import { StarDeltaPlant } from './plants/StarDeltaPlant.tsx';
import { TrafficPlant } from './plants/TrafficPlant.tsx';
import { ConveyorPlant } from './plants/ConveyorPlant.tsx';
import { TankPlant } from './plants/TankPlant.tsx';
import { TankPidPlant } from './plants/TankPidPlant.tsx';
import { CylindersPlant } from './plants/CylindersPlant.tsx';
import type { PlantProps } from './plants/common.tsx';
import { CheckPanel } from './CheckPanel.tsx';
import { PlantCanvas } from './plantBuilder/PlantCanvas.tsx';
import { OperateHelp, PlantActions } from './plantBuilder/PlantActions.tsx';
import { PlantStart } from './plantBuilder/PlantEditor.tsx';

// Each plant has its own state type; the registry is keyed by scenario id.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const RENDERERS: Record<string, (p: PlantProps<any>) => React.ReactNode> = {
  motor: MotorPlant,
  starDelta: StarDeltaPlant,
  traffic: TrafficPlant,
  conveyor: ConveyorPlant,
  tank: TankPlant,
  tankPid: TankPidPlant,
  cylinders: CylindersPlant,
};

export function PlantView() {
  const { t } = useTranslation();
  const scenarioId = useProject((s) => s.project.scenarioId);
  const design = useProject((s) => s.project.plant);
  const setView = useProject((s) => s.setView);
  const readOnly = useProject((s) => s.sharedId !== null);
  const update = useProject((s) => s.update);
  const state = useSim((s) => s.scenarioState);
  const plcValues = useSim((s) => s.snapshot?.values);
  // The plant is the field: faulty outputs (welded / burnt contactor) override what the PLC commands.
  const fieldOutputs = useSim((s) => s.faults.outputs);
  const values = useMemo(
    () => (plcValues && Object.keys(fieldOutputs).length ? { ...plcValues, ...fieldOutputs } : plcValues),
    [plcValues, fieldOutputs],
  );
  const { setInput, plantAction, send } = useSim.getState();
  const scenario = getScenario(scenarioId);

  if (design)
    return (
      <div className="plant">
        <div className="panel-head">
          <span>{t('builder.editableTitle')}</span>
          <span className="row">
            <button onClick={() => send({ type: 'resetPlant' })}>{t('plant.reset')}</button>
            <button onClick={() => setView('plant')} data-testid="plant-open-editor">
              {readOnly ? t('builder.openView') : `✎ ${t('builder.edit')}`}
            </button>
          </span>
        </div>
        <PlantCanvas design={design} />
        <PlantActions design={design} />
        <OperateHelp design={design} className="plant-msg" />
      </div>
    );

  if (!scenario) {
    return (
      <div className="plant pad">
        <p className="muted">{t('plant.none')}</p>
        {!readOnly && (
          <div className="scenario-list">
            <PlantStart compact />
            {SCENARIOS.map((sc) => (
              <div key={sc.id} className="scenario-card">
                <strong>{t(`plant.${sc.id}.title`)}</strong>
                <p className="muted small">{t(`plant.${sc.id}.summary`)}</p>
                <div className="row">
                  <button
                    data-testid={`use-scenario-${sc.id}`}
                    onClick={() =>
                      confirm(t('plant.applyConfirm')) && update((d) => applyScenario(d, sc.id, false))
                    }
                  >
                    {t('plant.apply')}
                  </button>
                  <button
                    onClick={() =>
                      confirm(t('plant.solutionConfirm')) && update((d) => applyScenario(d, sc.id, true))
                    }
                  >
                    {t('plant.applyWithSolution')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  const Renderer = RENDERERS[scenario.id];
  return (
    <div className="plant">
      <div className="panel-head">
        <span>{t(`plant.${scenario.id}.title`)}</span>
        <span className="row">
          <button onClick={() => send({ type: 'resetPlant' })}>{t('plant.reset')}</button>
          {!readOnly && (
            <button onClick={() => setView('plant')} title={t('builder.convertHint')}>
              ✎ {t('builder.convertShort')}
            </button>
          )}
          {!readOnly && (
            <button
              className="danger"
              onClick={() =>
                update((d) => {
                  delete d.scenarioId;
                })
              }
            >
              {t('plant.remove')}
            </button>
          )}
        </span>
      </div>
      {state && Renderer ? (
        <Renderer state={state} values={values} setInput={setInput} action={plantAction} />
      ) : null}
      <CheckPanel scenarioId={scenario.id} />
      <details className="task" open>
        <summary>{t('plant.task')}</summary>
        <p>{t(`plant.${scenario.id}.task`)}</p>
        <p className="muted small">{t('plant.tip')}</p>
        <table className="grid compact">
          <tbody>
            {scenario.tags.map((tg) => (
              <tr key={tg.name}>
                <td className="mono">{tg.name}</td>
                <td className="muted">{tg.io}</td>
                <td className="muted">{tg.comment}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

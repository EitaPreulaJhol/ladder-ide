/**
 * The fixed exercise plants rebuilt with components, as editable starting
 * points. They use the scenario's tag names, so the reference solutions run
 * on them unchanged (see test/plant.test.ts).
 */
import type { PlantComponent, PlantComponentKind, PlantDesign, PlantParam } from '../model.ts';
import type { Project } from '../model.ts';
import { createComponent } from './components.ts';
import { applyScenario } from '../scenarios/index.ts';

function comp(
  kind: PlantComponentKind,
  x: number,
  y: number,
  label: string,
  tags: Record<string, string>,
  params: Record<string, PlantParam> = {},
  size: { w?: number; h?: number } = {},
): PlantComponent {
  return createComponent(kind, x, y, label, { tags, params, ...size });
}

const startStop = (y: number, x = 20): PlantComponent[] => [
  comp('pushbutton', x, y, 'B_START', { out: 'B_START' }, { color: '#16a34a' }),
  comp('pushbutton', x + 56, y, 'B_STOP', { out: 'B_STOP' }, { color: '#dc2626', nc: true }),
];

const TEMPLATES: Record<string, () => PlantDesign> = {
  motor: () => ({
    width: 420,
    height: 200,
    components: [
      comp('motor', 30, 40, 'M1', { run: 'K_MOTOR', ovl: 'F_OVL' }),
      ...startStop(50, 150),
      comp('lamp', 300, 60, 'H_RUN', { on: 'H_RUN' }, { color: '#22c55e' }),
      comp('lamp', 360, 60, 'H_FAULT', { on: 'H_FAULT' }, { color: '#ef4444' }),
    ],
  }),
  starDelta: () => ({
    width: 420,
    height: 200,
    components: [
      comp(
        'motor',
        30,
        40,
        'M1',
        { main: 'K1_MAIN', star: 'K2_STAR', delta: 'K3_DELTA', ovl: 'F_OVL' },
        { start: 'starDelta', rampMs: 800 },
      ),
      ...startStop(50, 180),
    ],
  }),
  traffic: () => ({
    width: 360,
    height: 200,
    components: [
      comp('trafficLight', 60, 40, 'Veículos', { red: 'L_RED', yellow: 'L_YELLOW', green: 'L_GREEN' }),
      comp('trafficLight', 160, 60, 'Pedestres', { red: 'P_RED', green: 'P_GREEN' }, { lights: '2' }),
      comp('pushbutton', 250, 70, 'B_PED', { out: 'B_PED' }, { color: '#eab308' }),
    ],
  }),
  conveyor: () => {
    // Sensor heads at y 86: the beam starts at 100 (top of a tall part on the belt at 140).
    const sensor = (beamX: number, tag: string, range: number) =>
      comp('partSensor', beamX - 7, 86, tag, { out: tag }, { range });
    return {
      width: 400,
      height: 250,
      components: [
        comp('feeder', 30, 34, 'Alimentador', {}, { interval: 4.5, tallPct: 50 }),
        comp('conveyor', 20, 140, 'Esteira', { run: 'M_BELT' }, { speed: 27 }),
        sensor(62, 'S_ENTRY', 38),
        // Short parts (top at 118) pass under this beam; only tall ones (top at 100) cut it.
        sensor(125, 'S_HIGH', 10),
        sensor(206, 'S_PUSH', 38),
        sensor(299, 'S_END', 38),
        comp('pusher', 192, 160, 'Y_PUSH', { extend: 'Y_PUSH' }, { strokeMs: 300 }),
        comp('bin', 176, 6, 'Rejeito', {}, {}, { w: 60, h: 44 }),
        comp('bin', 300, 172, 'Saída', {}, {}, { w: 70, h: 44 }),
        ...startStop(170),
      ],
    };
  },
  tank: () => {
    const tank = comp(
      'tank',
      130,
      40,
      'TQ1',
      { lsl: 'LSL', lsh: 'LSH', lt: 'LT_LEVEL' },
      { capacity: 1000, initial: 30, lslPct: 15, lshPct: 85 },
      { w: 90, h: 160 },
    );
    return {
      width: 380,
      height: 240,
      components: [
        comp('pump', 30, 50, 'P_FILL', { run: 'P_FILL' }, { flow: 60, to: tank.id }),
        tank,
        comp(
          'valve',
          270,
          150,
          'Consumo',
          {},
          { mode: 'manual', flow: 50, opening: 40, lagMs: 0, from: tank.id },
        ),
        comp('lamp', 300, 20, 'H_ALARM', { on: 'H_ALARM' }, { color: '#ef4444' }),
        comp('display', 260, 70, 'LEVEL_PCT', { value: 'LEVEL_PCT' }, { unit: '%', decimals: 0 }),
      ],
    };
  },
  tankPid: () => {
    const tank = comp(
      'tank',
      150,
      40,
      'TQ1',
      { lt: 'LT_LEVEL' },
      { capacity: 1000, initial: 20 },
      { w: 90, h: 170 },
    );
    return {
      width: 400,
      height: 260,
      components: [
        comp(
          'valve',
          50,
          40,
          'CV_VALVE',
          { cmd: 'CV_VALVE' },
          { mode: 'proportional', flow: 80, lagMs: 1000, to: tank.id },
        ),
        comp(
          'potentiometer',
          10,
          104,
          'SP_PCT',
          { out: 'SP_PCT' },
          { min: 0, max: 100, initial: 50 },
          { w: 120 },
        ),
        comp('selector', 40, 176, 'PID_ON', { out: 'PID_ON' }, { initial: true }),
        tank,
        comp('display', 280, 16, 'LEVEL_PCT', { value: 'LEVEL_PCT' }, { unit: '%', decimals: 1 }),
        comp('display', 280, 82, 'CV_PCT', { value: 'CV_PCT' }, { unit: '%', decimals: 1 }),
        comp(
          'valve',
          280,
          166,
          'Consumo',
          {},
          { mode: 'manual', flow: 50, opening: 40, lagMs: 0, from: tank.id },
        ),
      ],
    };
  },
  cylinders: () => ({
    width: 400,
    height: 200,
    components: [
      comp('cylinder', 30, 40, 'A', { extend: 'Y_A', ret: 'A0', ext: 'A1' }, { strokeMs: 1200 }, { w: 220 }),
      comp('cylinder', 30, 120, 'B', { extend: 'Y_B', ret: 'B0', ext: 'B1' }, { strokeMs: 1000 }, { w: 220 }),
      comp('pushbutton', 310, 70, 'B_START', { out: 'B_START' }, { color: '#16a34a' }),
    ],
  }),
};

export const PLANT_TEMPLATE_IDS = Object.keys(TEMPLATES);

/** Editable version of a fixed scenario plant (fresh ids on every call). */
export function scenarioTemplate(scenarioId: string): PlantDesign | undefined {
  return TEMPLATES[scenarioId]?.();
}

/**
 * Starts an editable plant from a fixed scenario: creates and binds the
 * scenario tags, then replaces the scenario by its component version (the
 * automatic checks of the exercise no longer apply). Mutates the project.
 */
export function applyPlantTemplate(project: Project, scenarioId: string, withSolution = false): boolean {
  const design = scenarioTemplate(scenarioId);
  if (!design) return false;
  applyScenario(project, scenarioId, withSolution);
  delete project.scenarioId;
  project.plant = design;
  return true;
}

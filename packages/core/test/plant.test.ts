import { describe, expect, it } from 'vitest';
import {
  addPlantPortTag,
  applyPlantTemplate,
  coil,
  createComponent,
  createMissingPlantTags,
  createProject,
  initPlantState,
  no,
  parseProject,
  plantAction,
  PLANT_TEMPLATE_IDS,
  program,
  reconcilePlantState,
  renameTag,
  rung,
  SCENARIOS,
  Simulator,
  stepPlant,
  validateProject,
  type BinCompState,
  type CylinderCompState,
  type MotorCompState,
  type PlantComponent,
  type PlantIo,
  type PlantState,
  type Project,
  type TankCompState,
} from '../src/index.ts';

/** Program + plant running together, like the simulation worker does. */
function rig(p: Project) {
  const sim = new Simulator(p);
  const design = p.plant!;
  const state = initPlantState(design);
  const io: PlantIo = {
    get: (n) => {
      const v = sim.getValue(n);
      return typeof v === 'boolean' || typeof v === 'number' ? v : false;
    },
    set: (n, v) => sim.setInput(n, v),
  };
  const dt = p.sim.scanTimeMs;
  stepPlant(design, state, 0, io);
  sim.refreshInputs();
  const byLabel = (label: string) => design.components.find((c) => c.label === label)!;
  return {
    sim,
    state,
    comp: byLabel,
    st: <T>(label: string) => state.comps[byLabel(label).id] as T,
    run(ms: number) {
      const end = sim.timeMs + ms;
      while (sim.timeMs < end) {
        sim.scan(dt);
        stepPlant(design, state, dt, io);
      }
    },
    act(label: string, action: string, value?: unknown) {
      plantAction(design, state, `${byLabel(label).id}:${action}`, value);
      stepPlant(design, state, 0, io);
    },
    press(label: string, ms = 200) {
      this.act(label, 'press');
      this.run(ms);
      this.act(label, 'release');
    },
    bit: (tag: string) => sim.getValue(tag) === true,
  };
}

function templateProject(id: string, withSolution = true): Project {
  const p = createProject();
  applyPlantTemplate(p, id, withSolution);
  return p;
}

describe('plant templates', () => {
  it('exist for every fixed scenario, keep the scenario tags and validate', () => {
    expect(PLANT_TEMPLATE_IDS.sort()).toEqual(SCENARIOS.map((s) => s.id).sort());
    for (const id of PLANT_TEMPLATE_IDS) {
      const p = templateProject(id);
      expect(p.scenarioId).toBeUndefined();
      expect(p.plant?.components.length).toBeGreaterThan(0);
      const plantDiags = validateProject(p).filter((d) => d.code.startsWith('plant'));
      expect(plantDiags, id).toEqual([]);
      const r = parseProject(JSON.parse(JSON.stringify(p)));
      expect(r.ok && r.project).toEqual(p);
    }
  });

  it('motor: seal-in start, stop and thermal trip under heavy load', () => {
    const r = rig(templateProject('motor'));
    r.press('B_START');
    r.run(2000);
    expect(r.bit('K_MOTOR')).toBe(true);
    expect(r.st<MotorCompState>('M1').speed).toBeGreaterThan(0.9);
    r.press('B_STOP');
    expect(r.bit('K_MOTOR')).toBe(false);
    r.press('B_START');
    r.act('M1', 'toggleLoad');
    r.run(6000);
    expect(r.st<MotorCompState>('M1').tripped).toBe(true);
    expect(r.bit('K_MOTOR')).toBe(false);
    expect(r.bit('H_FAULT')).toBe(true);
  });

  it('star-delta: star then delta, never both, no hard start', () => {
    const r = rig(templateProject('starDelta'));
    r.press('B_START');
    r.run(2000);
    expect(r.st<MotorCompState>('M1').mode).toBe('star');
    r.run(5000);
    const m = r.st<MotorCompState>('M1');
    expect(m.mode).toBe('delta');
    expect(m.short).toBe(false);
    expect(m.hardStarts).toBe(0);
  });

  it('conveyor: tall parts go to the reject bin, short ones to the end', () => {
    const r = rig(templateProject('conveyor'));
    r.act('Alimentador', 'toggleAuto');
    r.press('B_START');
    for (const kind of ['tall', 'short', 'tall', 'short', 'short']) {
      r.act('Alimentador', 'drop', kind);
      r.run(5000);
    }
    r.run(12_000);
    const reject = r.st<BinCompState>('Rejeito');
    const out = r.st<BinCompState>('Saída');
    expect(reject).toMatchObject({ count: 2, tall: 2 });
    expect(out).toMatchObject({ count: 3, tall: 0 });
    expect(r.state.lost).toBe(0);
  });

  it('tank: on/off level control keeps the level between the switches', () => {
    const r = rig(templateProject('tank'));
    let min = 1;
    let max = 0;
    for (let t = 0; t < 120_000; t += 500) {
      r.run(500);
      const level = r.st<TankCompState>('TQ1').level;
      min = Math.min(min, level);
      max = Math.max(max, level);
    }
    // The pump cycles between the switches (15% and 85%).
    expect(min).toBeLessThan(0.2);
    expect(max).toBeGreaterThan(0.8);
    const t = r.st<TankCompState>('TQ1');
    expect(t.overflows).toBe(0);
    expect(t.level).toBeGreaterThan(0.1);
    expect(t.level).toBeLessThan(0.9);
  });

  it('tank PID: reaches the setpoint from the potentiometer', () => {
    const r = rig(templateProject('tankPid'));
    r.run(120_000);
    expect(Math.abs(r.st<TankCompState>('TQ1').level * 100 - 50)).toBeLessThan(3);
    r.act('SP_PCT', 'set', 0.7);
    r.run(150_000);
    expect(Math.abs(r.st<TankCompState>('TQ1').level * 100 - 70)).toBeLessThan(3);
  });

  it('cylinders: A+ B+ A- B- cycle with end switches', () => {
    const r = rig(templateProject('cylinders'));
    const arrivals: string[] = [];
    const prev: Record<string, boolean> = { A0: true, A1: false, B0: true, B1: false };
    r.press('B_START');
    for (let t = 0; t < 6000; t += 20) {
      r.run(20);
      for (const s of ['A1', 'B1', 'A0', 'B0']) {
        if (r.bit(s) && !prev[s]) arrivals.push(s);
        prev[s] = r.bit(s);
      }
    }
    expect(arrivals).toEqual(['A1', 'B1', 'A0', 'B0']);
    expect(r.st<CylinderCompState>('A').pos).toBe(0);
  });
});

describe('plant components', () => {
  function blank(components: PlantComponent[]): Project {
    const p = createProject();
    p.plant = { width: 640, height: 360, components };
    return p;
  }

  it('double-acting cylinder keeps moving after the pulse (valve memory)', () => {
    const cyl = createComponent('cylinder', 10, 10, 'C1', {
      params: { action: 'double', strokeMs: 500 },
    });
    const p = blank([cyl]);
    createMissingPlantTags(p, () => '');
    addPlantPortTag(p, cyl.id, 'ext', '');
    expect(cyl.tags).toMatchObject({ extend: 'C1_EXTEND', retract: 'C1_RETRACT', ext: 'C1_EXT' });
    p.programs = [program('P', [rung([no('PULSE'), coil('C1_EXTEND')])])];
    p.tags.push({ name: 'PULSE', type: 'BOOL' });
    const r = rig(p);
    r.sim.setForce('PULSE', true);
    r.run(100);
    r.sim.setForce('PULSE', false);
    r.run(600);
    expect(r.bit('C1_EXT')).toBe(true);
  });

  it('tanks exchange fluid through pumps and valves, without negative volume', () => {
    const a = createComponent('tank', 0, 0, 'A', { params: { capacity: 100, initial: 10 } });
    const b = createComponent('tank', 200, 0, 'B', { params: { capacity: 100, initial: 0 } });
    const pump = createComponent('pump', 100, 0, 'P1', { params: { flow: 10, from: a.id, to: b.id } });
    const p = blank([a, b, pump]);
    createMissingPlantTags(p, () => '');
    const r = rig(p);
    r.sim.setForce('P1_RUN', true);
    r.run(3000);
    const sa = r.st<TankCompState>('A');
    const sb = r.st<TankCompState>('B');
    expect(sa.level).toBe(0);
    expect(sb.level).toBeCloseTo(0.1, 5);
  });

  it('inductive sensors only see metal parts; NC sensors invert', () => {
    const belt = createComponent('conveyor', 0, 100, 'BELT', { w: 200 });
    const feed = createComponent('feeder', 2, 20, 'F', { params: { interval: 0, metalPct: 0 } });
    const ind = createComponent('partSensor', 13, 60, 'IND', { params: { type: 'inductive', range: 60 } });
    const opt = createComponent('partSensor', 13, 60, 'OPT', { params: { nc: true, range: 60 } });
    const p = blank([belt, feed, ind, opt]);
    createMissingPlantTags(p, () => '');
    expect(p.tags.find((t) => t.name === 'OPT')?.initial).toBe(true);
    const r = rig(p);
    expect(r.bit('OPT')).toBe(true);
    r.act('F', 'drop');
    r.run(1000);
    expect(r.bit('OPT')).toBe(false);
    expect(r.bit('IND')).toBe(false);
  });

  it('oven heats towards ambient + gain and the thermostat switches', () => {
    const oven = createComponent('oven', 0, 0, 'F1', { params: { tau: 10, tshC: 100 } });
    const p = blank([oven]);
    createMissingPlantTags(p, () => '');
    addPlantPortTag(p, oven.id, 'tsh', '');
    addPlantPortTag(p, oven.id, 'temp', '');
    const r = rig(p);
    r.sim.setForce('F1_HEAT', true);
    r.run(60_000);
    expect(r.bit('F1_TSH')).toBe(true);
    const raw = r.sim.getValue('F1_TEMP') as number;
    expect((raw / 27648) * 200).toBeGreaterThan(190);
  });

  it('operator devices write only on change, so the I/O panel can share the tag', () => {
    const sw = createComponent('selector', 0, 0, 'SW1');
    const p = blank([sw]);
    createMissingPlantTags(p, () => '');
    const r = rig(p);
    r.sim.setInput('SW1', true);
    r.run(500);
    expect(r.bit('SW1')).toBe(true);
    r.act('SW1', 'toggle');
    r.run(100);
    expect(r.bit('SW1')).toBe(true);
    r.act('SW1', 'toggle');
    r.run(100);
    expect(r.bit('SW1')).toBe(false);
  });

  it('reconcile keeps existing state and adds new components', () => {
    const t = createComponent('tank', 0, 0, 'A', { params: { initial: 50 } });
    const p = blank([t]);
    const st: PlantState = initPlantState(p.plant!);
    (st.comps[t.id] as TankCompState).level = 0.8;
    const lamp = createComponent('lamp', 0, 0, 'L');
    p.plant!.components.push(lamp);
    reconcilePlantState(st, p.plant!);
    expect((st.comps[t.id] as TankCompState).level).toBe(0.8);
    expect(st.comps[lamp.id]).toEqual({});
  });

  it('validation reports unknown tags, wrong types and unbound ports', () => {
    const m = createComponent('motor', 0, 0, 'M1', { tags: { run: 'NOPE', fb: 'LEVEL' } });
    const p = blank([m, createComponent('lamp', 0, 0, 'L1')]);
    p.tags.push({ name: 'LEVEL', type: 'INT' });
    const codes = validateProject(p)
      .filter((d) => d.code.startsWith('plant'))
      .map((d) => d.code);
    expect(codes.sort()).toEqual(['plantTagType', 'plantUnbound', 'plantUnknownTag']);
  });

  it('renaming a tag updates plant bindings (and HMI, Modbus, trend, GRAFCET)', () => {
    const p = templateProject('motor');
    p.hmi = {
      screens: [
        {
          id: 's',
          name: 'S',
          widgets: [{ id: 'w', kind: 'lamp', tag: 'K_MOTOR', label: '', x: 0, y: 0, w: 10, h: 10 }],
        },
      ],
    };
    p.modbus = { map: [{ tag: 'K_MOTOR', area: 'coil', address: 0 }] };
    p.trend = ['K_MOTOR'];
    p.grafcets = [
      {
        id: 'g',
        name: 'G',
        prefix: 'G_',
        steps: [
          { id: 'a', actions: ['K_MOTOR'] },
          { id: 'b', actions: [] },
        ],
        transitions: [
          { id: 't', condition: 'K_MOTOR & !K_MOTOR2' },
          { id: 'u', condition: 'T#2s' },
        ],
        loopTo: 0,
        programId: 'x',
      },
    ];
    renameTag(p, 'K_MOTOR', 'KM1');
    expect(p.plant!.components.find((c) => c.kind === 'motor')!.tags.run).toBe('KM1');
    expect(p.hmi.screens[0]!.widgets[0]!.tag).toBe('KM1');
    expect(p.modbus.map[0]!.tag).toBe('KM1');
    expect(p.trend).toEqual(['KM1']);
    expect(p.grafcets[0]!.steps[0]!.actions).toEqual(['KM1']);
    expect(p.grafcets[0]!.transitions[0]!.condition).toBe('KM1 & !K_MOTOR2');
  });
});

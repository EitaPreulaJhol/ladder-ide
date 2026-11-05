import { describe, expect, it } from 'vitest';
import {
  applyScenario,
  createProject,
  FieldFaults,
  faultCandidates,
  kindsFor,
  Simulator,
  type Project,
} from '../src/index.ts';

function motor(): { p: Project; sim: Simulator; faults: FieldFaults } {
  const p = createProject();
  applyScenario(p, 'motor', true);
  return { p, sim: new Simulator(p), faults: new FieldFaults() };
}

const pulse = (sim: Simulator, tag: string) => {
  sim.setInput(tag, true);
  sim.scan(10);
  sim.setInput(tag, false);
  sim.scan(10);
};

describe('field faults', () => {
  it('lists I/O candidates with suitable kinds', () => {
    const p = createProject();
    applyScenario(p, 'tank', true);
    const c = faultCandidates(p);
    expect(c.find((x) => x.signal === 'LSL')).toEqual({ signal: 'LSL', direction: 'input', analog: false });
    expect(c.find((x) => x.signal === 'P_FILL')?.direction).toBe('output');
    expect(c.find((x) => x.signal === 'LT_LEVEL')?.analog).toBe(true);
    expect(c.some((x) => x.signal === 'LEVEL_PCT')).toBe(false); // memory, not field
    expect(kindsFor({ analog: true })).toEqual(['stuckOff', 'frozen']);
  });

  it('a stuck input is what the PLC reads, whatever the field does', () => {
    const { p, sim, faults } = motor();
    faults.add(p, sim, 'B_START', 'stuckOn');
    sim.setInput('B_START', false);
    sim.scan(10);
    expect(sim.getValue('B_START')).toBe(true);
    expect(sim.getValue('K_MOTOR')).toBe(true);
    expect(sim.snapshot().forces).toEqual({}); // not a force: invisible in the force list
    faults.remove(sim, 'B_START');
    sim.scan(10);
    expect(sim.getValue('B_START')).toBe(false);
  });

  it('a broken wire on the NC stop button stops the motor ("fio rompido")', () => {
    const { p, sim, faults } = motor();
    pulse(sim, 'B_START');
    expect(sim.getValue('K_MOTOR')).toBe(true);
    faults.add(p, sim, 'B_STOP', 'stuckOff');
    sim.scan(10);
    expect(sim.getValue('K_MOTOR')).toBe(false);
  });

  it('output faults change the field, not the PLC output', () => {
    const { p, sim, faults } = motor();
    faults.add(p, sim, 'K_MOTOR', 'stuckOff');
    pulse(sim, 'B_START');
    expect(sim.getValue('K_MOTOR')).toBe(true); // the PLC thinks it is on
    expect(faults.outputOverride('K_MOTOR')).toBe(false); // the contactor never pulls in
    expect(faults.outputOverrides()).toEqual({ K_MOTOR: false });
  });

  it('frozen analog keeps the value at injection time; force beats fault', () => {
    const p = createProject();
    applyScenario(p, 'tank', true);
    const sim = new Simulator(p);
    const faults = new FieldFaults();
    sim.setInput('LT_LEVEL', 5000);
    sim.scan(10);
    faults.add(p, sim, 'LT_LEVEL', 'frozen');
    sim.setInput('LT_LEVEL', 20000);
    sim.scan(10);
    expect(sim.getValue('LT_LEVEL')).toBe(5000);
    sim.setForce('LT_LEVEL', 100);
    sim.scan(10);
    expect(sim.getValue('LT_LEVEL')).toBe(100);
  });

  it('challenge: hidden fault, wrong and right guesses, reveal', () => {
    const { p, sim, faults } = motor();
    let i = 0;
    const seq = [0.0, 0.0]; // first candidate, first kind
    expect(faults.startChallenge(p, sim, () => seq[i++] ?? 0)).toBe(true);
    expect(faults.challengeActive).toBe(true);
    expect(faults.visible()).toEqual([]);
    expect(faults.guess(sim, 'H_RUN', 'stuckOn')).toBe('wrongSignal');
    expect(faults.guess(sim, 'B_START', 'stuckOff')).toBe('wrongKind');
    expect(faults.guess(sim, 'B_START', 'stuckOn')).toBe('correct');
    expect(faults.attempts).toBe(3);
    expect(faults.challengeActive).toBe(false);
    expect(faults.guess(sim, 'B_START', 'stuckOn')).toBe('noChallenge');

    faults.startChallenge(p, sim, () => 0.99);
    const revealed = faults.reveal(sim)!;
    expect(revealed.signal).toBeTruthy();
    expect(faults.challengeActive).toBe(false);
  });
});

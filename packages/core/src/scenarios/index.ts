import type { Project } from '../model.ts';
import type { ScenarioDef } from './types.ts';
import { motorScenario } from './motor.ts';
import { starDeltaScenario } from './starDelta.ts';
import { trafficScenario } from './traffic.ts';
import { conveyorScenario } from './conveyor.ts';
import { tankScenario } from './tank.ts';
import { catalogFor, createModule, findFreeChannel, nextFreeSlot } from '../hardware.ts';

export * from './types.ts';
export { BELT } from './conveyor.ts';
export { TANK, ANALOG_FULL_SCALE } from './tank.ts';
export type { MotorState } from './motor.ts';
export type { StarDeltaState } from './starDelta.ts';
export type { TrafficState } from './traffic.ts';
export type { ConveyorState, Box } from './conveyor.ts';
export type { TankState } from './tank.ts';

export const SCENARIOS: ScenarioDef<any>[] = [
  motorScenario,
  starDeltaScenario,
  trafficScenario,
  conveyorScenario,
  tankScenario,
];

export const getScenario = (id: string | undefined) => SCENARIOS.find((s) => s.id === id);

/**
 * Attaches a scenario to a project (mutates it): creates/updates its tags and binds
 * I/O tags to free hardware channels, adding modules to the rack when needed.
 * Optionally replaces the programs with the reference solution.
 */
export function applyScenario(project: Project, scenarioId: string, withSolution: boolean): void {
  const sc = getScenario(scenarioId);
  if (!sc) return;
  project.scenarioId = sc.id;
  for (const def of sc.tags) {
    let tag = project.tags.find((t) => t.name === def.name);
    if (!tag) {
      tag = { name: def.name, type: def.type, comment: def.comment };
      project.tags.push(tag);
    } else {
      tag.type = def.type;
      tag.comment ||= def.comment;
    }
    if (def.initial !== undefined) tag.initial = def.initial;
    if (def.io === 'MEM') continue;
    const boundOk =
      tag.io && project.hardware.modules.some((m) => m.id === tag!.io!.module && m.kind === def.io);
    if (boundOk) continue;
    delete tag.address;
    let ch = findFreeChannel(project, [def.io]);
    if (!ch) {
      const hw = project.hardware;
      const options = catalogFor(hw)
        .filter((c) => c.kind === def.io)
        .sort((a, b) => b.channels - a.channels);
      let slot: number | null;
      if (hw.family === 'generic') {
        const used = new Set(hw.modules.map((m) => m.slot));
        slot = 0;
        while (used.has(slot)) slot++;
        if (slot >= hw.slots) hw.slots = slot + 1;
      } else slot = nextFreeSlot(hw);
      if (options[0] && slot !== null) {
        hw.modules.push(createModule(options[0].id, slot, hw));
        ch = findFreeChannel(project, [def.io]);
      }
    }
    if (ch) tag.io = ch;
  }
  if (withSolution) project.programs = [sc.solution()];
}

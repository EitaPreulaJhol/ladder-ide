import { createProject, program, Simulator, type Project, type Rung, type Tag } from '../src/index.ts';

export function makeProject(tags: Tag[], rungs: Rung[]): Project {
  const p = createProject('teste');
  p.hardware.modules = [];
  p.tags = tags;
  p.programs = [program('Main', rungs)];
  return p;
}

export function runFor(sim: Simulator, ms: number, dt = 10) {
  for (let t = 0; t < ms; t += dt) sim.scan(dt);
}

export const val = (sim: Simulator, name: string) => sim.getValue(name);

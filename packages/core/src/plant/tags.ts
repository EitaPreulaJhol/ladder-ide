/** Tags of the editable plant: types per port, automatic creation and validation. */
import type { DataType, PlantComponent, Project, Tag } from '../model.ts';
import { ensureIoBinding, isOutputTag } from '../hardware.ts';
import { isValidTagName } from '../operand.ts';
import { activePorts, portRestValue, strParam, type PortIo } from './components.ts';
import type { Diagnostic } from '../validate.ts';

const NUMERIC = new Set<DataType>(['INT', 'DINT', 'REAL']);

/** Type of a tag created for a port (ANY ports get no automatic tag). */
export function portTagType(io: PortIo): DataType | undefined {
  if (io === 'DI' || io === 'DO') return 'BOOL';
  if (io === 'AI' || io === 'AO') return 'INT';
  return undefined;
}

/** Whether a tag can be bound to a port of the given direction. */
export function tagFitsPort(tag: Tag, io: PortIo): boolean {
  if (io === 'DI' || io === 'DO') return tag.type === 'BOOL';
  if (io === 'AI' || io === 'AO') return NUMERIC.has(tag.type);
  return tag.type !== 'TIMER' && tag.type !== 'COUNTER';
}

const KIND_PREFIX: Record<string, string> = {
  conveyor: 'CONV',
  feeder: 'FEED',
  partSensor: 'S',
  pusher: 'PUSH',
  bin: 'BIN',
  cylinder: 'CYL',
  motor: 'M',
  tank: 'TK',
  pump: 'P',
  valve: 'V',
  lamp: 'H',
  siren: 'SIREN',
  trafficLight: 'SEM',
  oven: 'OVEN',
  display: 'DISP',
  pushbutton: 'B',
  selector: 'SW',
  estop: 'ESTOP',
  potentiometer: 'POT',
  label: 'TXT',
};

/** Free tag name for a port, derived from the component label (`M1` + `fb` → `M1_FB`). */
export function suggestPortTagName(project: Project, c: PlantComponent, port: string): string {
  let base = c.label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24);
  if (!base || !isValidTagName(base)) base = KIND_PREFIX[c.kind] ?? 'PLANT';
  // Single-port devices use the label alone (`B_START`); others get the port suffix.
  const single = activePorts(c).filter((p) => p.io !== 'ANY').length === 1;
  const stem = single ? base : `${base}_${port.toUpperCase()}`;
  const used = new Set(project.tags.map((t) => t.name.toUpperCase()));
  let name = stem;
  for (let i = 2; used.has(name.toUpperCase()); i++) name = `${stem}_${i}`;
  return name;
}

/**
 * Creates a tag for a component port, binds it to a free hardware channel and
 * connects the port. Mutates the project; returns the tag name.
 */
export function addPlantPortTag(
  project: Project,
  componentId: string,
  port: string,
  comment: string,
  name?: string,
): string | undefined {
  const c = project.plant?.components.find((x) => x.id === componentId);
  const def = c && activePorts(c).find((p) => p.name === port);
  if (!c || !def) return undefined;
  const type = portTagType(def.io);
  if (!type) return undefined;
  const tagName = name ?? suggestPortTagName(project, c, port);
  let tag = project.tags.find((t) => t.name === tagName);
  if (!tag) {
    tag = { name: tagName, type, comment };
    const rest = portRestValue(c, port);
    if (rest !== undefined) tag.initial = rest;
    project.tags.push(tag);
  }
  if (def.io !== 'ANY') ensureIoBinding(project, tag, def.io);
  c.tags[port] = tagName;
  return tagName;
}

/** Creates tags for every required port that has none. Returns how many were created. */
export function createMissingPlantTags(
  project: Project,
  comment: (c: PlantComponent, port: string) => string,
): number {
  let n = 0;
  for (const c of project.plant?.components ?? [])
    for (const p of activePorts(c))
      if (!p.optional && p.io !== 'ANY' && !c.tags[p.name]) {
        if (addPlantPortTag(project, c.id, p.name, comment(c, p.name))) n++;
      }
  return n;
}

/** Problems of the plant bindings, shown with the program diagnostics. */
export function validatePlant(project: Project): Diagnostic[] {
  const out: Diagnostic[] = [];
  const tags = new Map(project.tags.map((t) => [t.name, t]));
  const components = project.plant?.components ?? [];
  const tankIds = new Set(components.filter((c) => c.kind === 'tank').map((c) => c.id));
  for (const c of components) {
    if (c.kind === 'pump' || c.kind === 'valve') {
      const ends = [strParam(c, 'from'), strParam(c, 'to')];
      const params = { component: c.label || c.kind };
      if (ends.some((id) => id && !tankIds.has(id)))
        out.push({ severity: 'warning', code: 'plantMissingTank', params });
      else if (ends.every((id) => !id)) out.push({ severity: 'warning', code: 'plantNotConnected', params });
    }
    const ports = activePorts(c);
    for (const p of ports) {
      const name = c.tags[p.name];
      const params = { component: c.label || c.kind, port: p.name, name: name ?? '' };
      if (!name) {
        if (!p.optional && p.io !== 'ANY') out.push({ severity: 'warning', code: 'plantUnbound', params });
        continue;
      }
      const tag = tags.get(name);
      if (!tag) out.push({ severity: 'error', code: 'plantUnknownTag', params, tag: name });
      else if (!tagFitsPort(tag, p.io))
        out.push({ severity: 'error', code: 'plantTagType', params, tag: name });
      else if ((p.io === 'DI' || p.io === 'AI') && isOutputTag(tag, project.hardware))
        out.push({ severity: 'warning', code: 'plantWritesOutput', params, tag: name });
    }
  }
  return out;
}

/** Short default label for a new component (`M1`, `S3`, `TK2`), which also seeds its tag names. */
export function nextComponentLabel(components: PlantComponent[], kind: PlantComponent['kind']): string {
  const prefix = KIND_PREFIX[kind] ?? 'X';
  const used = new Set(components.map((c) => c.label.toUpperCase()));
  let n = 1;
  while (used.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

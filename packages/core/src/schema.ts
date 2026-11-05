/** Runtime validation of project files (used by the web app on import and by the server on share). */
import { z } from 'zod';
import type { LadderNode, Project } from './model.ts';
import { SCHEMA_VERSION } from './model.ts';
import { INSTRUCTION_IDS } from './instructions.ts';
import { migrateProject } from './migrations.ts';
import { COMPONENT_KINDS } from './plant/components.ts';

const id = z.string().min(1).max(64);
const text = (max: number) => z.string().max(max);

const AddressSchema = z.object({
  area: z.enum(['I', 'Q', 'M', 'T', 'C']),
  index: z.number().int().min(0).max(65535),
  bit: z.number().int().min(0).max(15).optional(),
});

const TagSchema = z.object({
  name: z
    .string()
    .regex(/^[A-Za-z_][A-Za-z0-9_]*$/)
    .max(64),
  type: z.enum(['BOOL', 'INT', 'DINT', 'REAL', 'TIMER', 'COUNTER']),
  address: AddressSchema.optional(),
  comment: text(500).optional(),
  initial: z.union([z.number(), z.boolean()]).optional(),
  io: z.object({ module: id, channel: z.number().int().min(0).max(63) }).optional(),
});

const ElementSchema = z.object({
  kind: z.literal('el'),
  id,
  instr: z.enum(INSTRUCTION_IDS as [string, ...string[]]),
  operands: z.array(text(200)).max(8),
});

const NodeSchema: z.ZodType<LadderNode> = z.lazy(() =>
  z.union([
    ElementSchema,
    z.object({ kind: z.literal('par'), id, branches: z.array(z.array(NodeSchema).max(256)).max(64) }),
  ]),
) as unknown as z.ZodType<LadderNode>;

const RungSchema = z.object({ id, comment: text(2000).optional(), body: z.array(NodeSchema).max(256) });

const GrafcetSchema = z.object({
  id,
  name: text(100),
  prefix: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,20}$/),
  steps: z
    .array(z.object({ id, actions: z.array(text(64)).max(32), comment: text(500).optional() }))
    .min(2)
    .max(100),
  transitions: z.array(z.object({ id, condition: text(500) })).max(100),
  loopTo: z.number().int().min(0).max(99),
  programId: id,
});

const ProgramSchema = z.object({
  id,
  name: text(100),
  rungs: z.array(RungSchema).max(2000),
  kind: z.enum(['main', 'sub']).optional(),
  generatedBy: text(64).optional(),
});

const ModuleSchema = z.object({
  id,
  catalogId: text(64),
  slot: z.number().int().min(0).max(64),
  kind: z.enum(['CPU', 'PS', 'DI', 'DO', 'AI', 'AO']),
  channels: z.number().int().min(0).max(64),
  label: text(100).optional(),
  embedded: z.boolean().optional(),
});

const WidgetSchema = z.object({
  id,
  kind: z.enum(['pushbutton', 'pushbuttonNC', 'toggle', 'selector', 'sensor', 'lamp', 'display', 'slider']),
  tag: text(64),
  label: text(100),
  color: text(32).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
});

const HmiWidgetSchema = z.object({
  id,
  kind: z.enum([
    'pushbutton',
    'pushbuttonNC',
    'toggle',
    'selector',
    'sensor',
    'lamp',
    'display',
    'slider',
    'text',
    'bar',
    'numeric',
    'nav',
    'trend',
  ]),
  tag: text(80),
  label: text(200),
  x: z.number().min(-100).max(900),
  y: z.number().min(-100).max(600),
  w: z.number().min(10).max(800),
  h: z.number().min(10).max(480),
  color: text(32).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  target: text(64).optional(),
});

const HmiSchema = z.object({
  screens: z.array(z.object({ id, name: text(60), widgets: z.array(HmiWidgetSchema).max(200) })).max(30),
});

const PlantSchema = z.object({
  width: z.number().min(160).max(2000),
  height: z.number().min(120).max(1200),
  components: z
    .array(
      z.object({
        id,
        kind: z.enum(COMPONENT_KINDS as [string, ...string[]]),
        x: z.number().min(-200).max(2200),
        y: z.number().min(-200).max(1400),
        w: z.number().min(2).max(2000),
        h: z.number().min(2).max(1200),
        label: text(100),
        tags: z.record(z.string().max(32), text(64)).refine((r) => Object.keys(r).length <= 16),
        params: z
          .record(z.string().max(32), z.union([z.number(), z.boolean(), text(100)]))
          .refine((r) => Object.keys(r).length <= 32),
      }),
    )
    .max(300),
});

export const ProjectSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id,
  meta: z.object({
    name: text(200),
    description: text(5000).optional(),
    createdAt: text(40),
    updatedAt: text(40),
    forkedFrom: text(64).optional(),
  }),
  dialect: z.enum(['iec', 'ab', 'siemens', 'schneider', 'haiwell']),
  tags: z.array(TagSchema).max(5000),
  programs: z.array(ProgramSchema).min(1).max(50),
  hardware: z.object({
    family: z.enum(['generic', 's7-1200', 'micrologix', 'm221', 'haiwell']),
    cpu: text(64).optional(),
    rackName: text(100),
    slots: z.number().int().min(1).max(64),
    modules: z.array(ModuleSchema).max(64),
  }),
  ioPanel: z.array(WidgetSchema).max(200),
  scenarioId: text(64).optional(),
  sim: z.object({ scanTimeMs: z.number().min(1).max(1000) }),
  trend: z.array(text(80)).max(32).optional(),
  grafcets: z.array(GrafcetSchema).max(20).optional(),
  hmi: HmiSchema.optional(),
  modbus: z
    .object({
      map: z
        .array(
          z.object({
            tag: text(64),
            area: z.enum(['coil', 'discrete', 'holding', 'input']),
            address: z.number().int().min(0).max(65535),
          }),
        )
        .max(2000),
    })
    .optional(),
  plant: PlantSchema.optional(),
});

const MAX_DEPTH = 40;

/** Iterative depth check, done before schema validation to avoid deep recursion on hostile input. */
function jsonDepth(value: unknown): number {
  let max = 0;
  const stack: [unknown, number][] = [[value, 1]];
  while (stack.length) {
    const [v, d] = stack.pop()!;
    if (d > max) max = d;
    if (d > MAX_DEPTH) return d;
    if (v && typeof v === 'object') for (const child of Object.values(v)) stack.push([child, d + 1]);
  }
  return max;
}

export type ParseResult = { ok: true; project: Project } | { ok: false; error: string };

export function parseProject(raw: unknown): ParseResult {
  if (jsonDepth(raw) > MAX_DEPTH) return { ok: false, error: 'Projeto aninhado demais.' };
  let migrated: unknown;
  try {
    migrated = migrateProject(raw);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  const r = ProjectSchema.safeParse(migrated);
  if (!r.success) {
    const issue = r.error.issues[0];
    return { ok: false, error: issue ? `${issue.path.join('.')}: ${issue.message}` : 'Projeto inválido.' };
  }
  return { ok: true, project: r.data as Project };
}

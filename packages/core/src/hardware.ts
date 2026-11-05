/**
 * Hardware planning: generic module catalog, I/O addressing derived from the
 * rack layout and the dialect, I/O list and CSV export.
 */
import type {
  DataType,
  DialectId,
  FamilyId,
  HardwareConfig,
  HardwareModule,
  ModuleKind,
  Project,
  Tag,
} from './model.ts';
import { getDialect } from './dialects.ts';
import { newId } from './ids.ts';
import { familyCpu, getFamily } from './families.ts';

export interface CatalogItem {
  id: string;
  kind: ModuleKind;
  channels: number;
  name: string;
  description: string;
  partNumber?: string;
}

export const CATALOG: CatalogItem[] = [
  {
    id: 'ps-24vdc',
    kind: 'PS',
    channels: 0,
    name: 'Fonte 24 VCC / 5 A',
    description: 'Alimentação do rack e dos sensores',
  },
  {
    id: 'cpu-generic',
    kind: 'CPU',
    channels: 0,
    name: 'CPU genérica',
    description: 'Processador, memória e comunicação',
  },
  {
    id: 'di8',
    kind: 'DI',
    channels: 8,
    name: 'DI 8 × 24 VCC',
    description: 'Entradas digitais, tipo sink/source',
  },
  {
    id: 'di16',
    kind: 'DI',
    channels: 16,
    name: 'DI 16 × 24 VCC',
    description: 'Entradas digitais, tipo sink/source',
  },
  { id: 'do8r', kind: 'DO', channels: 8, name: 'DO 8 × relé', description: 'Saídas a relé, 2 A por ponto' },
  {
    id: 'do16t',
    kind: 'DO',
    channels: 16,
    name: 'DO 16 × transistor',
    description: 'Saídas a transistor 24 VCC, 0,5 A',
  },
  {
    id: 'ai4',
    kind: 'AI',
    channels: 4,
    name: 'AI 4 × 4–20 mA / 0–10 V',
    description: 'Entradas analógicas, 0–27648',
  },
  {
    id: 'ao2',
    kind: 'AO',
    channels: 2,
    name: 'AO 2 × 4–20 mA / 0–10 V',
    description: 'Saídas analógicas, 0–27648',
  },
];

export const catalogItem = (id: string) => CATALOG.find((c) => c.id === id);

/** Modules that can be added to this rack (family catalog, or the generic one). */
export function catalogFor(hw: HardwareConfig): CatalogItem[] {
  return getFamily(hw.family)?.modules ?? CATALOG;
}

/** Display data of a module of this rack (CPU models included). */
export function moduleInfo(
  hw: HardwareConfig,
  m: HardwareModule,
): { name: string; partNumber?: string; description: string } {
  const fam = getFamily(hw.family);
  if (fam && m.kind === 'CPU') {
    const cpu = fam.cpus.find((c) => c.id === m.catalogId);
    if (cpu) return { name: cpu.name, partNumber: cpu.partNumber, description: cpu.description };
  }
  if (m.embedded) {
    const cpu = familyCpu(hw);
    return {
      name: `${cpu?.name ?? 'CPU'} — ${m.kind} embarcadas`,
      partNumber: cpu?.partNumber,
      description: '',
    };
  }
  const item = catalogFor(hw).find((c) => c.id === m.catalogId) ?? catalogItem(m.catalogId);
  return {
    name: m.label || item?.name || m.catalogId,
    partNumber: item?.partNumber,
    description: item?.description ?? '',
  };
}

export const isInputKind = (k: ModuleKind) => k === 'DI' || k === 'AI';
export const isIoKind = (k: ModuleKind) => k === 'DI' || k === 'DO' || k === 'AI' || k === 'AO';
export const channelType = (k: ModuleKind): DataType => (k === 'AI' || k === 'AO' ? 'INT' : 'BOOL');

export function defaultHardware(): HardwareConfig {
  return {
    family: 'generic',
    rackName: 'Rack 0',
    slots: 8,
    modules: [
      { id: newId('m_'), catalogId: 'ps-24vdc', slot: 0, kind: 'PS', channels: 0 },
      { id: newId('m_'), catalogId: 'cpu-generic', slot: 1, kind: 'CPU', channels: 0 },
      { id: newId('m_'), catalogId: 'di16', slot: 2, kind: 'DI', channels: 16 },
      { id: newId('m_'), catalogId: 'do16t', slot: 3, kind: 'DO', channels: 16 },
    ],
  };
}

export function createModule(catalogId: string, slot: number, hw?: HardwareConfig): HardwareModule {
  const c = (hw ? catalogFor(hw) : CATALOG).find((x) => x.id === catalogId);
  if (!c) throw new Error(`Módulo desconhecido: ${catalogId}`);
  return { id: newId('m_'), catalogId, slot, kind: c.kind, channels: c.channels };
}

const KIND_ORDER: Record<ModuleKind, number> = { PS: 0, CPU: 1, DI: 2, DO: 3, AI: 4, AO: 5 };

/** Modules in physical order: by slot, CPU before its embedded I/O groups. */
export function sortedModules(hw: HardwareConfig): HardwareModule[] {
  return [...hw.modules].sort((a, b) => a.slot - b.slot || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
}

/** Slots where an expansion module may go (null = no restriction beyond the rack size). */
export function expansionSlots(hw: HardwareConfig): number[] {
  const fam = getFamily(hw.family);
  if (!fam) return Array.from({ length: hw.slots }, (_, i) => i);
  const max = familyCpu(hw)?.maxModules ?? 0;
  return Array.from({ length: max }, (_, i) => fam.cpuSlot + 1 + i);
}

/** First slot where a new expansion module can go, or null when the rack/CPU is full. */
export function nextFreeSlot(hw: HardwareConfig): number | null {
  const used = new Set(hw.modules.map((m) => m.slot));
  return expansionSlots(hw).find((s) => !used.has(s)) ?? null;
}

/** Builds the CPU module plus one embedded module per on-board I/O group. */
function cpuModules(familyId: FamilyId, cpuId: string): HardwareModule[] {
  const fam = getFamily(familyId);
  const cpu = fam?.cpus.find((c) => c.id === cpuId);
  if (!fam || !cpu) return [];
  const out: HardwareModule[] = [
    { id: newId('m_'), catalogId: cpu.id, slot: fam.cpuSlot, kind: 'CPU', channels: 0 },
  ];
  for (const kind of ['DI', 'DO', 'AI', 'AO'] as const) {
    const n = cpu.onboard[kind];
    if (n > 0)
      out.push({
        id: newId('m_'),
        catalogId: `${cpu.id}:${kind}`,
        slot: fam.cpuSlot,
        kind,
        channels: n,
        embedded: true,
      });
  }
  return out;
}

/**
 * Switches the project to a PLC family / CPU (mutates it). Expansion modules of the
 * same family are kept while they fit; I/O tags are re-bound to free channels of the
 * same kind in their previous order, so programs keep working.
 */
export function setPlcModel(project: Project, familyId: FamilyId, cpuId?: string): void {
  const hw = project.hardware;
  const bound = project.tags
    .filter((t) => t.io)
    .map((t) => ({ tag: t, kind: hw.modules.find((m) => m.id === t.io!.module)?.kind }));
  const sameFamily = hw.family === familyId;

  if (familyId === 'generic') {
    const fresh = defaultHardware();
    hw.family = 'generic';
    delete hw.cpu;
    hw.slots = fresh.slots;
    hw.modules = fresh.modules;
  } else {
    const fam = getFamily(familyId)!;
    const cpu = fam.cpus.find((c) => c.id === cpuId) ?? fam.cpus[0]!;
    const keep = sameFamily
      ? hw.modules.filter((m) => !m.embedded && m.kind !== 'CPU' && m.kind !== 'PS')
      : [];
    hw.family = familyId;
    hw.cpu = cpu.id;
    hw.slots = fam.cpuSlot + 1 + cpu.maxModules;
    const allowed = new Set(Array.from({ length: cpu.maxModules }, (_, i) => fam.cpuSlot + 1 + i));
    hw.modules = [...cpuModules(familyId, cpu.id), ...keep.filter((m) => allowed.has(m.slot))];
    project.dialect = fam.dialect;
  }

  // Re-bind: tags whose module still exists keep their channel. The others keep their
  // channel number on the first module of the same kind when it is free ("input 3 stays
  // input 3"), otherwise they get the next free channel.
  const lost: { tag: Tag; kind: ModuleKind; channel: number }[] = [];
  for (const { tag, kind } of bound) {
    const m = hw.modules.find((x) => x.id === tag.io!.module);
    if (m && tag.io!.channel < m.channels) continue;
    if (kind) lost.push({ tag, kind, channel: tag.io!.channel });
    delete tag.io;
  }
  const used = () => new Set(project.tags.filter((t) => t.io).map((t) => `${t.io!.module}:${t.io!.channel}`));
  for (const item of lost) {
    const first = sortedModules(hw).find((m) => m.kind === item.kind);
    if (first && item.channel < first.channels && !used().has(`${first.id}:${item.channel}`))
      item.tag.io = { module: first.id, channel: item.channel };
  }
  for (const item of lost) {
    if (item.tag.io) continue;
    const ch = findFreeChannel(project, [item.kind]);
    if (ch) item.tag.io = ch;
  }
}

/** Siemens convention: analog channels start at byte 64 (IW64 / QW64). */
const ANALOG_BASE_BYTE = 64;

/**
 * Start byte of every I/O module for sequential (byte-based) numbering.
 * Digital modules take ceil(channels / 8) bytes, analog modules 2 bytes per channel.
 */
function byteMap(hw: HardwareConfig): Map<string, number> {
  const map = new Map<string, number>();
  const next = { DI: 0, DO: 0, AI: ANALOG_BASE_BYTE, AO: ANALOG_BASE_BYTE } as Record<string, number>;
  for (const m of [...hw.modules].sort((a, b) => a.slot - b.slot)) {
    if (!isIoKind(m.kind)) continue;
    map.set(m.id, next[m.kind]!);
    next[m.kind]! += m.kind === 'AI' || m.kind === 'AO' ? m.channels * 2 : Math.ceil(m.channels / 8);
  }
  return map;
}

/** Address text of a hardware channel in the given dialect. */
export function channelAddress(
  hw: HardwareConfig,
  moduleId: string,
  channel: number,
  dialect: DialectId,
): string {
  const m = hw.modules.find((x) => x.id === moduleId);
  if (!m || !isIoKind(m.kind)) return '';
  const fam = getFamily(hw.family);
  if (fam) {
    const expansion = sortedModules(hw).filter((x) => isIoKind(x.kind) && !x.embedded);
    return fam.channelAddress(m, channel, expansion.indexOf(m) + 1, hw);
  }
  const input = isInputKind(m.kind);
  // Generic rack in the Schneider / Haiwell dialects.
  if (dialect === 'schneider') {
    const pos =
      sortedModules(hw)
        .filter((x) => isIoKind(x.kind))
        .findIndex((x) => x.id === m.id) + 1;
    const a = input ? 'I' : 'Q';
    return m.kind === 'AI' || m.kind === 'AO' ? `%${a}W${pos}.${channel}` : `%${a}${pos}.${channel}`;
  }
  if (dialect === 'haiwell') {
    let base = 0;
    for (const x of sortedModules(hw)) {
      if (x.id === m.id) break;
      if (x.kind === m.kind) base += x.channels;
    }
    return { DI: 'X', DO: 'Y', AI: 'AI', AO: 'AQ' }[m.kind as 'DI'] + (base + channel);
  }
  const analog = m.kind === 'AI' || m.kind === 'AO';
  if (getDialect(dialect).ioNumbering === 'slot') {
    const p = input ? 'I' : 'O';
    return analog ? `${p}:${m.slot}.${channel}` : `${p}:${m.slot}/${channel}`;
  }
  const base = byteMap(hw).get(m.id) ?? 0;
  const area = input ? 'I' : 'Q';
  if (analog) {
    const byte = base + channel * 2;
    return dialect === 'iec' ? `%${area}W${byte / 2}` : `${area}W${byte}`;
  }
  const byte = base + (channel >> 3);
  const bit = channel & 7;
  return dialect === 'iec' ? `%${area}X${byte}.${bit}` : `${area}${byte}.${bit}`;
}

/** Address text for any tag (hardware binding first, then manual address). */
export function tagAddress(tag: Tag, project: Pick<Project, 'hardware' | 'dialect'>): string {
  if (tag.io) return channelAddress(project.hardware, tag.io.module, tag.io.channel, project.dialect);
  if (tag.address) return getDialect(project.dialect).formatAddress(tag.address, tag.type);
  return '';
}

/** True for tags that drive field devices (output modules or Q area). */
export function isOutputTag(tag: Tag, hw: HardwareConfig): boolean {
  if (tag.io) {
    const m = hw.modules.find((x) => x.id === tag.io!.module);
    return !!m && (m.kind === 'DO' || m.kind === 'AO');
  }
  return tag.address?.area === 'Q';
}

/** True for tags whose value comes from the field (input modules or I area). */
export function isInputTag(tag: Tag, hw: HardwareConfig): boolean {
  if (tag.io) {
    const m = hw.modules.find((x) => x.id === tag.io!.module);
    return !!m && isInputKind(m.kind);
  }
  return tag.address?.area === 'I';
}

export interface IoRow {
  slot: number;
  moduleId: string;
  moduleName: string;
  kind: ModuleKind;
  channel: number;
  address: string;
  tag?: Tag;
}

export function ioList(project: Project): IoRow[] {
  const rows: IoRow[] = [];
  const byChannel = new Map<string, Tag>();
  for (const t of project.tags) if (t.io) byChannel.set(`${t.io.module}:${t.io.channel}`, t);
  for (const m of sortedModules(project.hardware)) {
    if (!isIoKind(m.kind)) continue;
    const info = moduleInfo(project.hardware, m);
    for (let ch = 0; ch < m.channels; ch++) {
      rows.push({
        slot: m.slot,
        moduleId: m.id,
        moduleName:
          info.partNumber && info.partNumber !== info.name ? `${info.name} (${info.partNumber})` : info.name,
        kind: m.kind,
        channel: ch,
        address: channelAddress(project.hardware, m.id, ch, project.dialect),
        tag: byChannel.get(`${m.id}:${ch}`),
      });
    }
  }
  return rows;
}

/** First free channel of the given kinds, used when binding new I/O tags automatically. */
export function findFreeChannel(
  project: Project,
  kinds: ModuleKind[],
): { module: string; channel: number } | null {
  const used = new Set(project.tags.filter((t) => t.io).map((t) => `${t.io!.module}:${t.io!.channel}`));
  for (const m of sortedModules(project.hardware)) {
    if (!kinds.includes(m.kind)) continue;
    for (let ch = 0; ch < m.channels; ch++)
      if (!used.has(`${m.id}:${ch}`)) return { module: m.id, channel: ch };
  }
  return null;
}

/**
 * Binds an I/O tag to a free channel of the given kind, adding a module to the
 * rack when none is free. Keeps a binding that already points to a module of
 * that kind. Mutates the project; returns false when no module fits.
 */
export function ensureIoBinding(project: Project, tag: Tag, kind: 'DI' | 'DO' | 'AI' | 'AO'): boolean {
  const hw = project.hardware;
  if (tag.io && hw.modules.some((m) => m.id === tag.io!.module && m.kind === kind)) return true;
  delete tag.address;
  let ch = findFreeChannel(project, [kind]);
  if (!ch) {
    const options = catalogFor(hw)
      .filter((c) => c.kind === kind)
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
      ch = findFreeChannel(project, [kind]);
    }
  }
  if (ch) tag.io = ch;
  return ch !== null;
}

function csvCell(v: string | number | undefined): string {
  const s = String(v ?? '');
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV with `;` separator (opens directly in Excel/LibreOffice with PT-BR locale). */
export function toCsv(header: string[], rows: (string | number | undefined)[][]): string {
  return '﻿' + [header, ...rows].map((r) => r.map(csvCell).join(';')).join('\r\n');
}

export function ioListCsv(project: Project): string {
  return toCsv(
    ['Slot', 'Módulo', 'Tipo', 'Canal', 'Endereço', 'Tag', 'Descrição'],
    ioList(project).map((r) => [
      r.slot,
      r.moduleName,
      r.kind,
      r.channel,
      r.address,
      r.tag?.name,
      r.tag?.comment,
    ]),
  );
}

export function tagsCsv(project: Project): string {
  return toCsv(
    ['Tag', 'Tipo', 'Endereço', 'Valor inicial', 'Descrição'],
    project.tags.map((t) => [
      t.name,
      t.type,
      tagAddress(t, project),
      t.initial === undefined ? '' : String(t.initial),
      t.comment,
    ]),
  );
}

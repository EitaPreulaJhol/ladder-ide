/**
 * Real PLC families: CPU models, expansion modules, slot rules, I/O addressing
 * and instruction availability.
 *
 * Data comes from manufacturer documentation listed in `sources`. Anything that
 * could not be confirmed in an official document is listed in `unverified` and
 * shown to the user, so the tool never presents a guess as a fact.
 */
import type {
  DialectId,
  FamilyId,
  HardwareConfig,
  HardwareModule,
  InstructionId,
  ModuleKind,
} from './model.ts';

export interface CpuModel {
  id: string;
  name: string;
  partNumber?: string;
  onboard: { DI: number; DO: number; AI: number; AO: number };
  /** Maximum expansion (signal) modules. */
  maxModules: number;
  description: string;
}

export interface ModuleModel {
  id: string;
  kind: ModuleKind;
  channels: number;
  name: string;
  partNumber?: string;
  description: string;
}

export interface Source {
  title: string;
  url: string;
}

export interface PlcFamily {
  id: Exclude<FamilyId, 'generic'>;
  vendor: string;
  name: string;
  dialect: DialectId;
  /** Rack slot of the CPU; expansion modules go in the following slots. */
  cpuSlot: number;
  cpus: CpuModel[];
  modules: ModuleModel[];
  unsupported: InstructionId[];
  /** Address of a channel. `position` is the 1-based order of the module among expansion modules. */
  channelAddress(module: HardwareModule, channel: number, position: number, hw: HardwareConfig): string;
  sources: Source[];
  /** Points that were not confirmed in official documentation (PT-BR, shown in the UI). */
  unverified: string[];
}

const isInput = (k: ModuleKind) => k === 'DI' || k === 'AI';
const isAnalog = (k: ModuleKind) => k === 'AI' || k === 'AO';

// ------------------------------------------------------------------ Siemens S7-1200

const s71200: PlcFamily = {
  id: 's7-1200',
  vendor: 'Siemens',
  name: 'SIMATIC S7-1200',
  dialect: 'siemens',
  cpuSlot: 1,
  cpus: [
    {
      id: '1211C',
      name: 'CPU 1211C DC/DC/DC',
      partNumber: '6ES7 211-1AE40-0XB0',
      onboard: { DI: 6, DO: 4, AI: 2, AO: 0 },
      maxModules: 0,
      description: '6 DI, 4 DQ e 2 AI embarcadas',
    },
    {
      id: '1212C',
      name: 'CPU 1212C DC/DC/DC',
      partNumber: '6ES7 212-1AE40-0XB0',
      onboard: { DI: 8, DO: 6, AI: 2, AO: 0 },
      maxModules: 2,
      description: '8 DI, 6 DQ e 2 AI embarcadas',
    },
    {
      id: '1214C',
      name: 'CPU 1214C DC/DC/DC',
      partNumber: '6ES7 214-1AG40-0XB0',
      onboard: { DI: 14, DO: 10, AI: 2, AO: 0 },
      maxModules: 8,
      description: '14 DI, 10 DQ e 2 AI embarcadas',
    },
    {
      id: '1215C',
      name: 'CPU 1215C DC/DC/DC',
      partNumber: '6ES7 215-1AG40-0XB0',
      onboard: { DI: 14, DO: 10, AI: 2, AO: 2 },
      maxModules: 8,
      description: '14 DI, 10 DQ, 2 AI e 2 AQ embarcadas',
    },
  ],
  modules: [
    {
      id: 'sm1221-di8',
      kind: 'DI',
      channels: 8,
      name: 'SM 1221 DI 8 × 24 VCC',
      partNumber: '6ES7 221-1BF32-0XB0',
      description: 'Entradas digitais',
    },
    {
      id: 'sm1221-di16',
      kind: 'DI',
      channels: 16,
      name: 'SM 1221 DI 16 × 24 VCC',
      partNumber: '6ES7 221-1BH32-0XB0',
      description: 'Entradas digitais',
    },
    {
      id: 'sm1222-dq8r',
      kind: 'DO',
      channels: 8,
      name: 'SM 1222 DQ 8 × relé',
      partNumber: '6ES7 222-1HF32-0XB0',
      description: 'Saídas a relé',
    },
    {
      id: 'sm1222-dq16r',
      kind: 'DO',
      channels: 16,
      name: 'SM 1222 DQ 16 × relé',
      partNumber: '6ES7 222-1HH32-0XB0',
      description: 'Saídas a relé',
    },
    {
      id: 'sm1222-dq16t',
      kind: 'DO',
      channels: 16,
      name: 'SM 1222 DQ 16 × 24 VCC',
      partNumber: '6ES7 222-1BH32-0XB0',
      description: 'Saídas a transistor',
    },
    {
      id: 'sm1231-ai4',
      kind: 'AI',
      channels: 4,
      name: 'SM 1231 AI 4 × 13 bit',
      partNumber: '6ES7 231-4HD32-0XB0',
      description: 'Entradas analógicas, tensão ou corrente',
    },
    {
      id: 'sm1231-ai8',
      kind: 'AI',
      channels: 8,
      name: 'SM 1231 AI 8 × 13 bit',
      partNumber: '6ES7 231-4HF32-0XB0',
      description: 'Entradas analógicas, tensão ou corrente',
    },
    {
      id: 'sm1232-aq2',
      kind: 'AO',
      channels: 2,
      name: 'SM 1232 AQ 2 × 14 bit',
      partNumber: '6ES7 232-4HB32-0XB0',
      description: 'Saídas analógicas',
    },
    {
      id: 'sm1232-aq4',
      kind: 'AO',
      channels: 4,
      name: 'SM 1232 AQ 4 × 14 bit',
      partNumber: '6ES7 232-4HD32-0XB0',
      description: 'Saídas analógicas',
    },
  ],
  unsupported: [],
  channelAddress(m, ch) {
    const area = isInput(m.kind) ? 'I' : 'Q';
    if (m.embedded) {
      if (isAnalog(m.kind)) return `${area}W${64 + ch * 2}`;
      return `${area}${ch >> 3}.${ch & 7}`;
    }
    // TIA Portal default: SM in slot 2 starts at byte 8 (digital) / 96 (analog).
    const slotOffset = Math.max(0, m.slot - 2);
    if (isAnalog(m.kind)) return `${area}W${96 + slotOffset * 16 + ch * 2}`;
    const byte = 8 + slotOffset * 4 + (ch >> 3);
    return `${area}${byte}.${ch & 7}`;
  },
  sources: [
    {
      title: 'SIMATIC S7-1200 Easy Book, 03/2014 (A5E02486774-AF)',
      url: 'https://media.distrelec.com/Web/Downloads/nu/al/s71200_eng_manual.pdf',
    },
  ],
  unverified: [
    'Endereço padrão dos SM a partir do slot 3 (regra usada: +4 bytes digitais e +16 bytes analógicos por slot). O manual confirma apenas o início no byte 8 para o slot 2.',
    'Endereço das saídas analógicas embarcadas da CPU 1215C (usado: QW64 e QW66).',
  ],
};

// ------------------------------------------------------------------ Allen-Bradley MicroLogix 1100/1400

const micrologix: PlcFamily = {
  id: 'micrologix',
  vendor: 'Allen-Bradley',
  name: 'MicroLogix 1100 / 1400',
  dialect: 'ab',
  cpuSlot: 0,
  cpus: [
    {
      id: '1763-L16BWA',
      name: 'MicroLogix 1100 (1763-L16BWA)',
      partNumber: '1763-L16BWA',
      onboard: { DI: 10, DO: 6, AI: 2, AO: 0 },
      maxModules: 4,
      description: '10 DI 24 VCC, 6 saídas a relé, 2 AI 0–10 V',
    },
    {
      id: '1766-L32BWA',
      name: 'MicroLogix 1400 (1766-L32BWA)',
      partNumber: '1766-L32BWA',
      onboard: { DI: 20, DO: 12, AI: 0, AO: 0 },
      maxModules: 7,
      description: '20 DI 24 VCC, 12 saídas a relé',
    },
    {
      id: '1766-L32AWA',
      name: 'MicroLogix 1400 (1766-L32AWA)',
      partNumber: '1766-L32AWA',
      onboard: { DI: 20, DO: 12, AI: 0, AO: 0 },
      maxModules: 7,
      description: '20 DI 120 VCA, 12 saídas a relé',
    },
    {
      id: '1766-L32BXB',
      name: 'MicroLogix 1400 (1766-L32BXB)',
      partNumber: '1766-L32BXB',
      onboard: { DI: 20, DO: 12, AI: 0, AO: 0 },
      maxModules: 7,
      description: '20 DI 24 VCC, 6 relés + 6 saídas CC',
    },
  ],
  modules: [
    {
      id: '1762-IQ8',
      kind: 'DI',
      channels: 8,
      name: '1762-IQ8',
      partNumber: '1762-IQ8',
      description: '8 entradas 24 VCC',
    },
    {
      id: '1762-IQ16',
      kind: 'DI',
      channels: 16,
      name: '1762-IQ16',
      partNumber: '1762-IQ16',
      description: '16 entradas 24 VCC',
    },
    {
      id: '1762-OW8',
      kind: 'DO',
      channels: 8,
      name: '1762-OW8',
      partNumber: '1762-OW8',
      description: '8 saídas a relé',
    },
    {
      id: '1762-OW16',
      kind: 'DO',
      channels: 16,
      name: '1762-OW16',
      partNumber: '1762-OW16',
      description: '16 saídas a relé',
    },
    {
      id: '1762-OB16',
      kind: 'DO',
      channels: 16,
      name: '1762-OB16',
      partNumber: '1762-OB16',
      description: '16 saídas 24 VCC',
    },
    {
      id: '1762-IF4',
      kind: 'AI',
      channels: 4,
      name: '1762-IF4',
      partNumber: '1762-IF4',
      description: '4 entradas analógicas',
    },
    {
      id: '1762-OF4',
      kind: 'AO',
      channels: 4,
      name: '1762-OF4',
      partNumber: '1762-OF4',
      description: '4 saídas analógicas',
    },
  ],
  // RSLogix 500 has no pulse timer, up/down counter in one instruction or negated coil.
  unsupported: ['TP', 'CTUD', 'NCOIL'],
  channelAddress(m, ch, position) {
    const p = isInput(m.kind) ? 'I' : 'O';
    if (m.embedded) return isAnalog(m.kind) ? `${p}:0.${4 + ch}` : `${p}:0/${ch}`;
    return isAnalog(m.kind) ? `${p}:${position}.${ch}` : `${p}:${position}/${ch}`;
  },
  sources: [
    {
      title: 'MicroLogix 1400 Reference Manual (1766-RM001)',
      url: 'http://www.efesotomasyon.com/Allen_Bradley_rockwell/1766-rm001_-en-p.pdf',
    },
    {
      title: 'Rockwell Automation — 1762 MicroLogix Expansion I/O',
      url: 'https://www.rockwellautomation.com/en-us/products/hardware/i-o/1762-micrologix-expansion-i-o.html',
    },
  ],
  unverified: ['Endereço das entradas analógicas embarcadas da MicroLogix 1100 (usado: I:0.4 e I:0.5).'],
};

// ------------------------------------------------------------------ Schneider Modicon M221

const m221: PlcFamily = {
  id: 'm221',
  vendor: 'Schneider Electric',
  name: 'Modicon M221',
  dialect: 'schneider',
  cpuSlot: 0,
  cpus: [
    {
      id: 'TM221CE16R',
      name: 'TM221CE16R',
      partNumber: 'TM221CE16R',
      onboard: { DI: 9, DO: 7, AI: 2, AO: 0 },
      maxModules: 7,
      description: '9 DI (4 rápidas), 7 saídas a relé, Ethernet',
    },
    {
      id: 'TM221CE24R',
      name: 'TM221CE24R',
      partNumber: 'TM221CE24R',
      onboard: { DI: 14, DO: 10, AI: 2, AO: 0 },
      maxModules: 7,
      description: '14 DI (4 rápidas), 10 saídas a relé, Ethernet',
    },
    {
      id: 'TM221CE40R',
      name: 'TM221CE40R',
      partNumber: 'TM221CE40R',
      onboard: { DI: 24, DO: 16, AI: 2, AO: 0 },
      maxModules: 7,
      description: '24 DI (4 rápidas), 16 saídas a relé, Ethernet',
    },
  ],
  modules: [
    {
      id: 'TM3DI8',
      kind: 'DI',
      channels: 8,
      name: 'TM3DI8',
      partNumber: 'TM3DI8',
      description: '8 entradas 24 VCC',
    },
    {
      id: 'TM3DI16',
      kind: 'DI',
      channels: 16,
      name: 'TM3DI16',
      partNumber: 'TM3DI16',
      description: '16 entradas 24 VCC',
    },
    {
      id: 'TM3DQ8R',
      kind: 'DO',
      channels: 8,
      name: 'TM3DQ8R',
      partNumber: 'TM3DQ8R',
      description: '8 saídas a relé',
    },
    {
      id: 'TM3DQ16R',
      kind: 'DO',
      channels: 16,
      name: 'TM3DQ16R',
      partNumber: 'TM3DQ16R',
      description: '16 saídas a relé',
    },
    {
      id: 'TM3DQ16T',
      kind: 'DO',
      channels: 16,
      name: 'TM3DQ16T',
      partNumber: 'TM3DQ16T',
      description: '16 saídas a transistor',
    },
    {
      id: 'TM3AI4',
      kind: 'AI',
      channels: 4,
      name: 'TM3AI4',
      partNumber: 'TM3AI4',
      description: '4 entradas analógicas',
    },
    {
      id: 'TM3AI8',
      kind: 'AI',
      channels: 8,
      name: 'TM3AI8',
      partNumber: 'TM3AI8',
      description: '8 entradas analógicas',
    },
    {
      id: 'TM3AQ2',
      kind: 'AO',
      channels: 2,
      name: 'TM3AQ2',
      partNumber: 'TM3AQ2',
      description: '2 saídas analógicas',
    },
    {
      id: 'TM3AQ4',
      kind: 'AO',
      channels: 4,
      name: 'TM3AQ4',
      partNumber: 'TM3AQ4',
      description: '4 saídas analógicas',
    },
  ],
  // %TM timers are TON, TOF or TP only.
  unsupported: ['RTO'],
  channelAddress(m, ch, position) {
    const area = isInput(m.kind) ? 'I' : 'Q';
    const y = m.embedded ? 0 : position;
    return isAnalog(m.kind) ? `%${area}W${y}.${ch}` : `%${area}${y}.${ch}`;
  },
  sources: [
    {
      title: 'Modicon M221 Logic Controller — Hardware Guide (EIO0000003313.02)',
      url: 'https://media.distributordatasolutions.com/schneider_synd/2023q2/documents/7b507a5b3fa61db9cd3e81af48f85472c3402124.pdf',
    },
    {
      title: 'Modicon M221 Logic Controller — Programming Guide (EIO0000003297)',
      url: 'https://www.bluenote.ro/navigator/scada_shop_repository/Documente_produse/PLC/Ghid%20de%20programare_Modicon%20221_SCADA-Shop.ro.pdf',
    },
  ],
  unverified: [],
};

// ------------------------------------------------------------------ Haiwell C / T series

const haiwellCpu = (id: string, di: number, dout: number, expandable: boolean): CpuModel => ({
  id,
  name: id,
  partNumber: id,
  onboard: { DI: di, DO: dout, AI: 0, AO: 0 },
  maxModules: expandable ? 7 : 0,
  description: `${di} DI, ${dout} saídas a relé, 24 VCC`,
});

const haiwellFamily: PlcFamily = {
  id: 'haiwell',
  vendor: 'Haiwell',
  name: 'Haiwell séries C e T',
  dialect: 'haiwell',
  cpuSlot: 0,
  cpus: [
    haiwellCpu('C10S0R', 6, 4, false),
    haiwellCpu('C16S0R', 8, 8, false),
    haiwellCpu('C24S0R', 16, 8, false),
    haiwellCpu('C32S0R', 16, 16, false),
    haiwellCpu('C48S0R', 28, 20, false),
    haiwellCpu('C60S0R', 36, 24, false),
    haiwellCpu('T16S0R', 8, 8, true),
    haiwellCpu('T24S0R', 16, 8, true),
    haiwellCpu('T32S0R', 16, 16, true),
    haiwellCpu('T60S0R', 36, 24, true),
  ],
  modules: [
    {
      id: 'H08DI',
      kind: 'DI',
      channels: 8,
      name: 'H08DI',
      partNumber: 'H08DI',
      description: '8 entradas digitais',
    },
    {
      id: 'H16DI',
      kind: 'DI',
      channels: 16,
      name: 'H16DI',
      partNumber: 'H16DI',
      description: '16 entradas digitais',
    },
    {
      id: 'H08DOR',
      kind: 'DO',
      channels: 8,
      name: 'H08DOR',
      partNumber: 'H08DOR',
      description: '8 saídas a relé',
    },
    {
      id: 'H16DOR',
      kind: 'DO',
      channels: 16,
      name: 'H16DOR',
      partNumber: 'H16DOR',
      description: '16 saídas a relé',
    },
    {
      id: 'H16DOT',
      kind: 'DO',
      channels: 16,
      name: 'H16DOT',
      partNumber: 'H16DOT',
      description: '16 saídas a transistor NPN',
    },
    {
      id: 'S04AI',
      kind: 'AI',
      channels: 4,
      name: 'S04AI',
      partNumber: 'S04AI',
      description: '4 entradas analógicas, 12 bits',
    },
    {
      id: 'S08AI',
      kind: 'AI',
      channels: 8,
      name: 'S08AI',
      partNumber: 'S08AI',
      description: '8 entradas analógicas, 12 bits',
    },
    {
      id: 'S04AO',
      kind: 'AO',
      channels: 4,
      name: 'S04AO',
      partNumber: 'S04AO',
      description: '4 saídas analógicas, 12 bits',
    },
  ],
  // No dedicated retentive timer: retention is configured per timer memory area.
  unsupported: ['RTO'],
  channelAddress(m, ch, _position, hw) {
    // Points are numbered continuously: CPU first, then expansion modules in order.
    const ordered = [...hw.modules].sort(
      (a, b) => a.slot - b.slot || Number(!!b.embedded) - Number(!!a.embedded),
    );
    let base = 0;
    for (const other of ordered) {
      if (other.id === m.id) break;
      if (other.kind === m.kind) base += other.channels;
    }
    const n = base + ch;
    switch (m.kind) {
      case 'DI':
        return `X${n}`;
      case 'DO':
        return `Y${n}`;
      case 'AI':
        return `AI${n}`;
      default:
        return `AQ${n}`;
    }
  },
  sources: [
    {
      title: 'Haiwell PLC Products Catalogue',
      url: 'https://haiwell.com/daruanjianen/Haiwell%20PLC%20Catalogue.pdf',
    },
    {
      title: 'Weintek — Haiwell PLC Connection Guide (mapa de endereços)',
      url: 'https://dl.weintek.com/public/PLC_Connect_Guide/Haiwell_PLC.pdf',
    },
  ],
  unverified: [
    'Numeração dos pontos dos módulos de expansão (usado: continua após os pontos da CPU, na ordem dos módulos).',
    'Mnemônicos de comparação no ladder (usado: CMP com o operador).',
  ],
};

export const FAMILIES: PlcFamily[] = [s71200, micrologix, m221, haiwellFamily];

export const getFamily = (id: FamilyId | undefined): PlcFamily | undefined =>
  FAMILIES.find((f) => f.id === id);

export function familyCpu(hw: HardwareConfig): CpuModel | undefined {
  return getFamily(hw.family)?.cpus.find((c) => c.id === hw.cpu);
}

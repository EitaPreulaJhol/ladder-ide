/** Ready-made example projects for learning. */
import type { Project } from './model.ts';
import { createProject } from './project.ts';
import { coil, el, nc, no, par, program, reset, rung, tag } from './build.ts';
import { applyScenario, SCENARIOS } from './scenarios/index.ts';
import { findFreeChannel } from './hardware.ts';
import { newId } from './ids.ts';

export interface ExampleDef {
  id: string;
  build(): Project;
}

function bindIo(p: Project) {
  for (const t of p.tags) {
    if (t.type !== 'BOOL' || t.io || t.address) continue;
    if (/^(B|S)_/.test(t.name)) t.io = findFreeChannel(p, ['DI']) ?? undefined;
    else if (/^(K|H|Y|M)_/.test(t.name)) t.io = findFreeChannel(p, ['DO']) ?? undefined;
    if (!t.io) delete t.io;
  }
}

const widget = (
  kind: Project['ioPanel'][number]['kind'],
  tagName: string,
  label: string,
  color?: string,
) => ({
  id: newId('w_'),
  kind,
  tag: tagName,
  label,
  ...(color ? { color } : {}),
});

export const EXAMPLES: ExampleDef[] = [
  {
    id: 'sealIn',
    build() {
      const p = createProject('Exemplo: selo liga/desliga');
      p.tags = [
        tag('B_LIGA', 'BOOL', { comment: 'Botão liga (NA)' }),
        tag('B_DESLIGA', 'BOOL', { comment: 'Botão desliga (NF)', initial: true }),
        tag('K_LAMPADA', 'BOOL', { comment: 'Lâmpada / contator' }),
      ];
      p.programs = [
        program('Principal', [
          rung(
            [par([no('B_LIGA')], [no('K_LAMPADA')]), no('B_DESLIGA'), coil('K_LAMPADA')],
            'Circuito de selo (auto-retenção)',
          ),
        ]),
      ];
      p.tags.forEach(
        (t) => (t.io = findFreeChannel(p, [t.name.startsWith('B_') ? 'DI' : 'DO']) ?? undefined),
      );
      p.ioPanel = [
        widget('pushbutton', 'B_LIGA', 'Liga', '#16a34a'),
        widget('pushbuttonNC', 'B_DESLIGA', 'Desliga', '#dc2626'),
        widget('lamp', 'K_LAMPADA', 'Lâmpada', '#facc15'),
      ];
      return p;
    },
  },
  {
    id: 'blinker',
    build() {
      const p = createProject('Exemplo: pisca-pisca');
      p.tags = [
        tag('S_HABILITA', 'BOOL', { comment: 'Chave habilita' }),
        tag('H_PISCA', 'BOOL', { comment: 'Lâmpada piscante' }),
        tag('T_ON', 'TIMER', { comment: 'Tempo aceso' }),
        tag('T_OFF', 'TIMER', { comment: 'Tempo apagado' }),
      ];
      p.programs = [
        program('Principal', [
          rung([no('S_HABILITA'), nc('T_ON.DN'), el('TON', 'T_OFF', 'T#500ms')], 'Tempo apagado'),
          rung([no('T_OFF.DN'), el('TON', 'T_ON', 'T#500ms')], 'Tempo aceso (reinicia o ciclo ao terminar)'),
          rung([no('T_OFF.DN'), coil('H_PISCA')], 'Lâmpada acesa enquanto T_ON conta'),
        ]),
      ];
      bindIo(p);
      p.ioPanel = [widget('toggle', 'S_HABILITA', 'Habilita'), widget('lamp', 'H_PISCA', 'Pisca', '#f97316')];
      return p;
    },
  },
  {
    id: 'counter',
    build() {
      const p = createProject('Exemplo: contador de peças');
      p.tags = [
        tag('S_PECA', 'BOOL', { comment: 'Sensor de peça' }),
        tag('B_ZERA', 'BOOL', { comment: 'Botão zerar contagem' }),
        tag('H_LOTE', 'BOOL', { comment: 'Lote completo' }),
        tag('C_PECAS', 'COUNTER', { comment: 'Contador de peças' }),
        tag('PECAS', 'INT', { comment: 'Valor atual da contagem' }),
      ];
      p.programs = [
        program('Principal', [
          rung([no('S_PECA'), el('CTU', 'C_PECAS', '5')], 'Conta uma peça a cada borda de subida do sensor'),
          rung([no('C_PECAS.DN'), coil('H_LOTE')], 'Lote de 5 peças completo'),
          rung([no('B_ZERA'), el('RES', 'C_PECAS')], 'Zera o contador'),
          rung([el('MOVE', 'C_PECAS.ACC', 'PECAS')], 'Copia a contagem para exibição'),
        ]),
      ];
      bindIo(p);
      p.ioPanel = [
        widget('pushbutton', 'S_PECA', 'Peça'),
        widget('pushbutton', 'B_ZERA', 'Zerar', '#dc2626'),
        widget('display', 'PECAS', 'Contagem'),
        widget('lamp', 'H_LOTE', 'Lote OK', '#16a34a'),
      ];
      return p;
    },
  },
  {
    id: 'subroutines',
    build() {
      const p = createProject('Exemplo: sub-rotinas e saltos');
      p.tags = [
        tag('S_MANUT', 'BOOL', { comment: 'Chave de manutenção (pula a lógica automática)' }),
        tag('S_SENSOR', 'BOOL', { comment: 'Sensor da máquina' }),
        tag('S_ALARME', 'BOOL', { comment: 'Alarme ativo' }),
        tag('H_AUTO', 'BOOL', { comment: 'Lâmpada da lógica automática' }),
        tag('H_ALARME', 'BOOL', { comment: 'Sirene/lâmpada de alarme (pisca)' }),
        tag('T_PISCA', 'TIMER', { comment: 'Base de tempo do pisca' }),
      ];
      p.programs = [
        program('Principal', [
          rung([no('S_MANUT'), el('JMP', 'ALARMES')], 'Em manutenção: pula a lógica automática (JMP → LBL)'),
          rung(
            [no('S_SENSOR'), coil('H_AUTO')],
            'Lógica automática (não executa durante a manutenção: H_AUTO congela)',
          ),
          rung(
            [el('LBL', 'ALARMES'), no('S_ALARME'), el('CALL', 'Alarmes')],
            'Chama a sub-rotina só quando há alarme',
          ),
          rung(
            [nc('S_ALARME'), reset('H_ALARME')],
            'Sub-rotina não chamada não atualiza suas saídas: desliga H_ALARME aqui',
          ),
        ]),
        {
          ...program('Alarmes', [
            rung([nc('T_PISCA.DN'), el('TON', 'T_PISCA', 'T#1s')], 'Base de tempo de 1 s que se reinicia'),
            rung(
              [el('LT', 'T_PISCA.ACC', '500'), coil('H_ALARME')],
              'Pisca: aceso na primeira metade do ciclo',
            ),
          ]),
          kind: 'sub',
        },
      ];
      bindIo(p);
      p.ioPanel = [
        widget('toggle', 'S_MANUT', 'Manutenção'),
        widget('sensor', 'S_SENSOR', 'Sensor'),
        widget('toggle', 'S_ALARME', 'Alarme'),
        widget('lamp', 'H_AUTO', 'Automático', '#16a34a'),
        widget('lamp', 'H_ALARME', 'Alarme', '#dc2626'),
      ];
      return p;
    },
  },
  ...SCENARIOS.map((sc): ExampleDef => ({
    id: `scenario:${sc.id}`,
    build() {
      const p = createProject();
      applyScenario(p, sc.id, true);
      return p;
    },
  })),
];

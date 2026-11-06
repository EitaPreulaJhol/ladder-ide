# LADDER-IDE

Ambiente web aberto para **treinar, testar e planejar** programas Ladder de CLPs industriais.

- **Editor visual de rungs** — paleta clicável/arrastável, ramificações em paralelo (OU), cópia/colagem, desfazer/refazer, comentários por rung, criação automática de tags.
- **Simulador com ciclo de varredura real** — leitura de entradas → execução dos rungs em ordem → saídas; tempo simulado (0,1× a 10×), passo único, forçar tags, fluxo de energia animado. Roda num Web Worker.
- **Multi-dialeto** — o mesmo programa visto como **IEC 61131-3**, **Siemens** (TIA/STEP 7), **Allen-Bradley** (RSLogix 500), **Schneider** (Machine Expert Basic) ou **Haiwell** (HaiwellHappy): mnemônicos (`NO`/`XIC`, `S`/`OTL`/`SET`…), membros (`T1.Q`/`T1.DN`/`%TM1.V`) e endereços (`%IX0.0` / `I0.0` / `I:2/0` / `%I0.0` / `X0`). Com um modelo real escolhido, o dialeto segue o fabricante.
- **Gráfico de tendência** — sinais (tags ou membros como `T1.DN`) registrados scan a scan, com cursor, janela de tempo e exportação em CSV.
- **Correção automática dos exercícios** — "Verificar solução" roda o programa numa simulação isolada e acelerada da planta e confere cada critério; a gravação de cada teste abre no gráfico de tendência.
- **"Por que?" e referência cruzada** — explica o valor de uma tag durante a simulação (quem escreveu por último, caminho de energia, contato que bloqueia, bobina dupla) e lista onde cada tag é lida e escrita.
- **Injeção de falhas** — sensores travados, fio rompido, contatos colados e saídas queimadas no campo (não no programa), mais um desafio de falha escondida para treinar diagnóstico.
- **GRAFCET** — editor de etapas, transições e ações que gera o ladder automaticamente (método de uma memória por etapa), com etapas ativas destacadas durante a simulação.
- **Programas e sub-rotinas** — vários programas principais e sub-rotinas (`CALL`/`JSR`), saltos (`JMP`/`LBL`), biestáveis `SR`/`RS`, escala analógica (`SCALE`/`SCP`) e `PID`.
- **Telas de IHM** — editor de telas de operação (800 × 480) com botões, lâmpadas, displays, barras, entradas numéricas, navegação e gráficos, ligados às tags e operáveis durante a simulação.
- **Painel de I/O virtual** — botões NA/NF, chaves, sensores, lâmpadas, displays e potenciômetros ligados às tags.
- **Plantas virtuais com exercícios** — partida direta, estrela-triângulo, semáforo, esteira seletora, controle de nível liga/desliga, controle de nível com PID e cilindros pneumáticos A+ B+ A− B−, cada uma com enunciado, solução de referência e correção automática.
- **Planta editável** — monte a planta com componentes (esteiras, alimentador, sensores, expulsor, caixas, cilindros, motores, tanques, bombas, válvulas, forno, sinalização e botões), ligue cada sinal a uma tag e opere durante a simulação. As plantas dos exercícios podem ser abertas como ponto de partida editável.
- **Modelos reais de CLP** — Siemens S7-1200 (1211C/1212C/1214C/1215C), Allen-Bradley MicroLogix 1100/1400, Schneider Modicon M221 e Haiwell séries C/T: I/O embarcado, módulos de expansão com códigos de catálogo, limite de módulos por CPU, endereçamento padrão de cada fabricante e aviso de instruções que o modelo não tem. Dados tirados de manuais oficiais (fontes listadas na tela); pontos não confirmados aparecem marcados como "a confirmar".
- **Planejamento de hardware** — rack genérico ou do modelo escolhido; endereços calculados automaticamente; lista de I/O e tags em CSV; versão para impressão.
- **Funciona offline e pode ser instalado** (PWA): depois da primeira visita, editor, simulação e projetos salvos funcionam sem internet.
- **Documentação do projeto** pronta para imprimir ou salvar em PDF: capa, programas, tags com referência cruzada e lista de I/O.
- **Tema claro/escuro** — botão na barra superior alterna entre automático (segue o sistema), claro e escuro; a escolha fica salva no navegador.
- **PLCopen XML (IEC 61131-3 TC6)** — exporta e importa programas em Ladder para intercâmbio com CODESYS, OpenPLC/Beremiz e outras IDEs IEC.
- **Interface em português, inglês e espanhol.**
- **Projetos** salvos no navegador (IndexedDB) + exportar/importar `.ladder.json`; **links compartilháveis** imutáveis (snapshot) que qualquer pessoa pode abrir, simular e copiar (fork).

## Estrutura

```
packages/core   TypeScript puro: modelo, schema (zod), dialetos, famílias de CLP, interpretador, layout, validação, hardware, cenários
apps/web        React + Vite: interface (PT-BR com i18n em src/locales)
apps/server     Fastify + PostgreSQL (Drizzle): API de compartilhamento e servidor do build do web
e2e             Testes Playwright
```

O núcleo não tem dependência de interface: o mesmo código roda no navegador (simulação) e no servidor (validação dos projetos compartilhados). O servidor roda os fontes TypeScript direto no Node (type stripping), sem etapa de build.

## Desenvolvimento

Requisitos: Node ≥ 24 e (opcional) Docker para o PostgreSQL.

```bash
npm install
npm run db:up            # PostgreSQL em localhost:5432 (opcional)
cp .env.example .env     # sem DATABASE_URL o servidor usa memória
npm run dev              # web em http://localhost:5173 (proxy /api → :3000)
```

| Comando                                 | O que faz                                                                                                                                              |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm test`                              | testes unitários do núcleo e da API (Vitest)                                                                                                           |
| `npm run test:db`                       | testes da API contra o PostgreSQL do `db:up`                                                                                                           |
| `npm run typecheck`                     | checagem de tipos dos três pacotes                                                                                                                     |
| `npm run e2e`                           | testes de ponta a ponta (Playwright). Use `PLAYWRIGHT_CHROMIUM_PATH=/usr/bin/chromium` para o Chromium do sistema ou `npx playwright install chromium` |
| `npm run build`                         | build de produção do web                                                                                                                               |
| `npm run db:generate -w @ladder/server` | gera migração após alterar `apps/server/src/db/schema.ts`                                                                                              |

## Produção

```bash
POSTGRES_PASSWORD=troque-me docker compose up -d --build
# http://localhost:3000
```

Atrás de um proxy reverso, defina `TRUSTED_PROXIES` com o IP/CIDR do proxy (ex.: `172.16.0.0/12` ou `uniquelocal`) para o limite de requisições e as denúncias usarem o IP real do cliente. O proxy deve sobrescrever o `X-Forwarded-For` enviado pelo cliente. `TRUST_PROXY=1` ainda funciona, mas confia no cabeçalho vindo de qualquer origem: qualquer pessoa que alcance o servidor diretamente pode forjar IPs.

## Proteção e administração

- **Denúncias:** quem abre um link compartilhado pode denunciá-lo. Com `REPORT_HIDE_THRESHOLD` denúncias de pessoas diferentes (padrão 3), o link fica oculto até a revisão. Nenhum IP é guardado: só um hash com o segredo `HASH_SALT`.
- **Validade opcional** (1, 7, 30 ou 90 dias) escolhida ao compartilhar; links vencidos são apagados a cada hora.
- **Limite total** de armazenamento dos links (`STORAGE_LIMIT_MB`, padrão 512).
- **Cabeçalhos de segurança:** Content-Security-Policy restrita à própria origem, `X-Frame-Options: DENY`, `Permissions-Policy` e, com `HSTS=1`, `Strict-Transport-Security`.
- **Administração:** defina `ADMIN_TOKEN` (24+ caracteres aleatórios). Sem ele, as rotas de administração não existem. Cada IP pode fazer até 30 requisições por minuto nessas rotas, contando tentativas com token errado.

```bash
TOKEN=...   # o mesmo ADMIN_TOKEN do servidor
curl -H "Authorization: Bearer $TOKEN" https://seu-servidor/api/admin/reports            # links denunciados
curl -X POST -H "Authorization: Bearer $TOKEN" https://seu-servidor/api/admin/shares/ID/restore  # libera (zera denúncias)
curl -X POST -H "Authorization: Bearer $TOKEN" https://seu-servidor/api/admin/shares/ID/hide     # oculta
curl -X DELETE -H "Authorization: Bearer $TOKEN" https://seu-servidor/api/admin/shares/ID        # remove
```

## Ponte Modbus TCP (IHM / SCADA real)

Para ligar uma IHM ou SCADA de verdade à simulação que roda no navegador:

```bash
npm run bridge                 # ou: node apps/bridge/src/index.ts [--modbus-port 5020] [--ws-port 8765] [--lan] [--origin URL]
```

A ponte mostra um **código de pareamento**. Na IDE, abra Hardware → Ponte Modbus TCP, informe a porta (8765) e o código, e conecte. A IHM então acessa o Modbus TCP da ponte (porta 5020): bits em coils, números em holding registers (mapa automático ou personalizado; DINT/REAL em 2 registradores, palavra alta primeiro).

- **Segurança:** o WebSocket só escuta em `127.0.0.1` e exige o código; o Modbus escuta só em localhost, a menos que se use `--lan`. Modbus não tem autenticação, então use `--lan` só em rede de laboratório.
- **Origem da página:** a ponte só aceita a IDE aberta em `localhost`. Se a IDE estiver hospedada num servidor, autorize o endereço dela com `--origin https://seu-servidor` (repetível, ou `LADDER_BRIDGE_ORIGINS=a,b`). O painel da ponte na IDE já mostra o comando com a origem correta.
- **Código errado:** depois de 5 códigos errados seguidos, o pareamento fica bloqueado por 30 s (o tempo dobra a cada novo erro, até 15 min).

## API

| Método | Rota              | Descrição                                                                                        |
| ------ | ----------------- | ------------------------------------------------------------------------------------------------ |
| `POST` | `/api/shares`     | corpo `{ project }`; valida com o schema do núcleo (máx. 1 MB, 20/min por IP) e retorna `{ id }` |
| `GET`  | `/api/shares/:id` | retorna `{ id, title, createdAt, project }` (imutável, com cache longo)                          |
| `GET`  | `/api/health`     | verificação de saúde                                                                             |

## Semântica do simulador (resumo)

- Rungs executam de cima para baixo; dentro do rung, da esquerda para a direita; **todos** os ramos em paralelo são avaliados.
- Bobina dupla: a última escrita no scan vence (o validador avisa).
- `TON`/`TOF`/`TP`/`RTO` usam o tempo simulado (`dt` = tempo de scan do projeto). Presets em ms ou literal IEC (`T#1m30s`).
- `CTU`/`CTD` contam bordas de subida; `CTUD` usa o 3º operando como entrada de decremento; `RES` zera temporizador/contador.
- `INT` é 16 bits com estouro (32767 + 1 = −32768), `DINT` 32 bits, `REAL` ponto flutuante; `DIV` em destino inteiro trunca; divisão por zero não escreve e desliga a saída do bloco.
- Entradas físicas (canais DI/AI ou endereços `I`) vêm da imagem de entradas a cada scan; tags forçadas ignoram escrita do programa.
- A planta (fixa ou editável) roda depois de cada scan: lê as saídas do CLP, avança a física pelo `dt` e escreve os sensores na imagem de entradas do próximo scan. Botões, chaves e potenciômetros da planta só escrevem quando mudam, então o painel de I/O pode comandar a mesma tag.

## Idiomas

Os textos ficam em `apps/web/src/locales/pt-BR.json`. Para adicionar um idioma, crie outro arquivo com as mesmas chaves e registre-o em `apps/web/src/i18n.ts`.

## Adicionando um modelo de CLP

Os perfis ficam em `packages/core/src/families.ts`: CPUs (I/O embarcado, limite de módulos), módulos de expansão, regra de endereçamento (`channelAddress`), instruções não suportadas, **fontes** e a lista `unverified` com o que não foi confirmado em documentação oficial. Acrescente casos em `packages/core/test/families.test.ts` com endereços tirados do manual do fabricante.

## Contribuindo

- Trabalhe num branch a partir do `master`: `feat/<assunto>`, `fix/<assunto>` ou `docs/<assunto>`.
- Antes do PR, rode `npm run check` e `npm run e2e`. A CI (`.github/workflows/ci.yml`) roda tudo isso, mais os testes com PostgreSQL e o build da imagem Docker.
- Mensagens de commit em português, com um título curto e o detalhe no corpo.
- Mudou o formato do projeto? Incremente `SCHEMA_VERSION` e adicione a migração em `packages/core/src/migrations.ts`.
- O roteiro de melhorias está em [`docs/plans.md`](docs/plans.md).

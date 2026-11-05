# LADDER IDE

Ambiente web aberto (sem login) para **treinar, testar e planejar** programas Ladder de CLPs industriais.

- **Editor visual de rungs** — paleta clicável/arrastável, ramificações em paralelo (OU), cópia/colagem, desfazer/refazer, comentários por rung, criação automática de tags.
- **Simulador com ciclo de varredura real** — leitura de entradas → execução dos rungs em ordem → saídas; tempo simulado (0,1× a 10×), passo único, forçar tags, fluxo de energia animado. Roda num Web Worker.
- **Multi-dialeto** — o mesmo programa visto como **IEC 61131-3**, **Siemens** (TIA/STEP 7), **Allen-Bradley** (RSLogix 500), **Schneider** (Machine Expert Basic) ou **Haiwell** (HaiwellHappy): mnemônicos (`NO`/`XIC`, `S`/`OTL`/`SET`…), membros (`T1.Q`/`T1.DN`/`%TM1.V`) e endereços (`%IX0.0` / `I0.0` / `I:2/0` / `%I0.0` / `X0`). Com um modelo real escolhido, o dialeto segue o fabricante.
- **Gráfico de tendência** — sinais (tags ou membros como `T1.DN`) registrados scan a scan, com cursor, janela de tempo e exportação em CSV.
- **Correção automática dos exercícios** — "Verificar solução" roda o programa numa simulação isolada e acelerada da planta e confere cada critério; a gravação de cada teste abre no gráfico de tendência.
- **"Por que?" e referência cruzada** — explica o valor de uma tag durante a simulação (quem escreveu por último, caminho de energia, contato que bloqueia, bobina dupla) e lista onde cada tag é lida e escrita.
- **Injeção de falhas** — sensores travados, fio rompido, contatos colados e saídas queimadas no campo (não no programa), mais um desafio de falha escondida para treinar diagnóstico.
- **Painel de I/O virtual** — botões NA/NF, chaves, sensores, lâmpadas, displays e potenciômetros ligados às tags.
- **Plantas virtuais com exercícios** — partida direta, estrela-triângulo, semáforo, esteira seletora e controle de nível, cada uma com enunciado e solução de referência.
- **Modelos reais de CLP** — Siemens S7-1200 (1211C/1212C/1214C/1215C), Allen-Bradley MicroLogix 1100/1400, Schneider Modicon M221 e Haiwell séries C/T: I/O embarcado, módulos de expansão com códigos de catálogo, limite de módulos por CPU, endereçamento padrão de cada fabricante e aviso de instruções que o modelo não tem. Dados tirados de manuais oficiais (fontes listadas na tela); pontos não confirmados aparecem marcados como "a confirmar".
- **Planejamento de hardware** — rack genérico ou do modelo escolhido; endereços calculados automaticamente; lista de I/O e tags em CSV; versão para impressão.
- **Tema claro/escuro** — botão na barra superior alterna entre automático (segue o sistema), claro e escuro; a escolha fica salva no navegador.
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

Atrás de um proxy reverso, defina `TRUST_PROXY=1` para o limite de requisições usar o IP real do cliente.

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

#!/usr/bin/env node
/**
 * LADDER IDE — ponte Modbus TCP.
 *   node apps/bridge/src/index.ts [--modbus-port 5020] [--ws-port 8765] [--token CODIGO] [--lan]
 *                                 [--origin https://ide.exemplo.com ...]
 */
import { networkInterfaces } from 'node:os';
import { newToken, normalizeOrigin, startBridge } from './bridge.ts';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const token = arg('token') ?? process.env.LADDER_BRIDGE_TOKEN ?? newToken();
const lan = process.argv.includes('--lan');
// Origens (além de localhost) de onde a IDE pode conectar: --origin repetível e/ou LADDER_BRIDGE_ORIGINS=a,b.
const origins = [
  ...process.argv.flatMap((a, i) => (a === '--origin' && process.argv[i + 1] ? [process.argv[i + 1]!] : [])),
  ...(process.env.LADDER_BRIDGE_ORIGINS ?? '').split(','),
]
  .map((s) => s.trim())
  .filter(Boolean);
const invalid = origins.filter((o) => !normalizeOrigin(o));
if (invalid.length) {
  console.error(`Origem inválida: ${invalid.join(', ')} (use o formato https://servidor[:porta]).`);
  process.exit(1);
}
const bridge = await startBridge({
  token,
  wsPort: Number(arg('ws-port') ?? 8765),
  modbusPort: Number(arg('modbus-port') ?? 5020),
  lan,
  origins,
  log: (m) => console.log(`[ponte] ${m}`),
});

const ips = Object.values(networkInterfaces())
  .flat()
  .filter((i) => i && i.family === 'IPv4' && !i.internal)
  .map((i) => i!.address);

console.log(`
LADDER IDE — ponte Modbus TCP
  Código de pareamento:  ${token}
  WebSocket (IDE):       ws://127.0.0.1:${bridge.wsPort}
  IDE aceita de:         localhost${origins.length ? `, ${origins.map(normalizeOrigin).join(', ')}` : ''}
  Modbus TCP:            ${lan ? ips.map((ip) => `${ip}:${bridge.modbusPort}`).join(', ') || `0.0.0.0:${bridge.modbusPort}` : `127.0.0.1:${bridge.modbusPort}`}

Na IDE: Hardware > Ponte Modbus TCP, informe a porta ${bridge.wsPort} e o código acima.
${lan ? '\nATENÇÃO: --lan expõe o Modbus TCP (sem autenticação, como todo Modbus) para a rede local.\nUse só em redes de laboratório confiáveis.\n' : 'Para uma IHM em outra máquina da rede, use --lan (somente em rede de laboratório confiável).'}
Ctrl+C para encerrar.`);

const stop = async () => {
  await bridge.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

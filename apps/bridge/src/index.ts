#!/usr/bin/env node
/**
 * LADDER IDE — ponte Modbus TCP.
 *   node apps/bridge/src/index.ts [--modbus-port 5020] [--ws-port 8765] [--token CODIGO] [--lan]
 */
import { networkInterfaces } from 'node:os';
import { newToken, startBridge } from './bridge.ts';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const token = arg('token') ?? process.env.LADDER_BRIDGE_TOKEN ?? newToken();
const lan = process.argv.includes('--lan');
const bridge = await startBridge({
  token,
  wsPort: Number(arg('ws-port') ?? 8765),
  modbusPort: Number(arg('modbus-port') ?? 5020),
  lan,
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

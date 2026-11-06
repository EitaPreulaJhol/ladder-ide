import { fileURLToPath } from 'node:url';
import { buildApp } from './app.ts';
import { MemoryShareStore, PgShareStore, type ShareStore } from './store.ts';

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';
const staticDir = process.env.STATIC_DIR ?? fileURLToPath(new URL('../../web/dist', import.meta.url));

let store: ShareStore;
if (process.env.DATABASE_URL) {
  store = await PgShareStore.connect(process.env.DATABASE_URL);
} else {
  console.warn(
    '[ladder] DATABASE_URL não definido: usando armazenamento em memória (links somem ao reiniciar).',
  );
  store = new MemoryShareStore();
}

const adminToken = process.env.ADMIN_TOKEN || undefined;
if (adminToken && adminToken.length < 24)
  console.warn(
    '[ladder] ADMIN_TOKEN curto demais (use 24+ caracteres aleatórios): rotas de administração desativadas.',
  );
if (!process.env.HASH_SALT)
  console.warn(
    '[ladder] HASH_SALT não definido: denúncias de uma mesma pessoa só são agrupadas até o servidor reiniciar.',
  );

// X-Forwarded-For só é aceito de proxies conhecidos (IPs/CIDRs ou 'loopback', 'uniquelocal'...).
const trustedProxies = (process.env.TRUSTED_PROXIES ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const trustProxy = trustedProxies.length ? trustedProxies : process.env.TRUST_PROXY === '1';
if (trustProxy === true)
  console.warn(
    '[ladder] TRUST_PROXY=1 aceita X-Forwarded-For de qualquer origem (permite burlar o rate limit e as denúncias). ' +
      'Prefira TRUSTED_PROXIES com o IP/CIDR do proxy reverso.',
  );

const app = await buildApp({
  store,
  staticDir,
  logger: true,
  trustProxy,
  adminToken: adminToken && adminToken.length >= 24 ? adminToken : undefined,
  hashSalt: process.env.HASH_SALT || undefined,
  storageLimitBytes: process.env.STORAGE_LIMIT_MB
    ? Number(process.env.STORAGE_LIMIT_MB) * 1024 * 1024
    : undefined,
  reportHideThreshold: process.env.REPORT_HIDE_THRESHOLD
    ? Number(process.env.REPORT_HIDE_THRESHOLD)
    : undefined,
  hsts: process.env.HSTS === '1',
});

const shutdown = async () => {
  await app.close();
  await store.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port, host });

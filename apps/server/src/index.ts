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

const app = await buildApp({
  store,
  staticDir,
  logger: true,
  trustProxy: process.env.TRUST_PROXY === '1',
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

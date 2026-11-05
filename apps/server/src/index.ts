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

const app = await buildApp({ store, staticDir, logger: true, trustProxy: process.env.TRUST_PROXY === '1' });

const shutdown = async () => {
  await app.close();
  await store.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port, host });

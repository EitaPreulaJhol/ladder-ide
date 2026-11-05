import Fastify, { type FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { customAlphabet } from 'nanoid';
import { existsSync } from 'node:fs';
import { parseProject } from '@ladder/core';
import type { ShareStore } from './store.ts';

export interface AppOptions {
  store: ShareStore;
  /** Built web app to serve (apps/web/dist). */
  staticDir?: string;
  logger?: boolean;
  trustProxy?: boolean;
  /** POST /api/shares per IP per minute. */
  shareRateLimit?: number;
}

export const MAX_PROJECT_BYTES = 1024 * 1024;
const newShareId = customAlphabet('23456789abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ', 10);
const ID_RE = /^[A-Za-z0-9]{6,32}$/;

export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ?? false,
    trustProxy: opts.trustProxy ?? false,
    bodyLimit: MAX_PROJECT_BYTES + 4096,
  });

  await app.register(rateLimit, { global: false });

  app.addHook('onSend', async (_req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  });

  app.get('/api/health', async () => ({ ok: true }));

  app.post(
    '/api/shares',
    { config: { rateLimit: { max: opts.shareRateLimit ?? 20, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const body = req.body as { project?: unknown } | undefined;
      const result = parseProject(body?.project);
      if (!result.ok) return reply.code(400).send({ error: 'invalidProject', message: result.error });
      const project = result.project;
      if (JSON.stringify(project).length > MAX_PROJECT_BYTES)
        return reply.code(413).send({ error: 'tooLarge', message: 'Projeto grande demais.' });
      const id = newShareId();
      await opts.store.create({ id, title: project.meta.name.slice(0, 200), project, createdAt: new Date() });
      return reply.code(201).send({ id });
    },
  );

  app.get(
    '/api/shares/:id',
    { config: { rateLimit: { max: 300, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      if (!ID_RE.test(id)) return reply.code(404).send({ error: 'notFound' });
      const rec = await opts.store.get(id);
      if (!rec) return reply.code(404).send({ error: 'notFound' });
      // Snapshots never change, so they can be cached forever.
      reply.header('Cache-Control', 'public, max-age=31536000, immutable');
      return { id: rec.id, title: rec.title, createdAt: rec.createdAt.toISOString(), project: rec.project };
    },
  );

  if (opts.staticDir && existsSync(opts.staticDir)) {
    await app.register(fastifyStatic, { root: opts.staticDir, wildcard: false });
    // SPA fallback: client-side routes such as /s/:id get index.html.
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/'))
        return reply.type('text/html').sendFile('index.html');
      return reply.code(404).send({ error: 'notFound' });
    });
  }

  return app;
}

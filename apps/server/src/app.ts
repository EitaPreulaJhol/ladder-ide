import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { customAlphabet } from 'nanoid';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { parseProject } from '@ladder/core';
import { REPORT_REASONS, type ReportReason, type ShareStore } from './store.ts';

export interface AppOptions {
  store: ShareStore;
  /** Built web app to serve (apps/web/dist). */
  staticDir?: string;
  logger?: boolean;
  trustProxy?: boolean;
  /** POST /api/shares per IP per minute. */
  shareRateLimit?: number;
  /** Enables /api/admin/* (Bearer token). Without it, the admin routes do not exist. */
  adminToken?: string;
  /** Secret mixed into reporter hashes. Random per process when not given. */
  hashSalt?: string;
  /** Total size of all shared projects. */
  storageLimitBytes?: number;
  /** Distinct reporters needed to hide a share until an admin reviews it. */
  reportHideThreshold?: number;
  /** Send Strict-Transport-Security (only behind HTTPS). */
  hsts?: boolean;
  /** Interval of the expired-shares cleanup (0 disables it). */
  cleanupIntervalMs?: number;
  /** Clock, injectable for tests. */
  now?: () => Date;
}

export const MAX_PROJECT_BYTES = 1024 * 1024;
export const DEFAULT_STORAGE_LIMIT = 512 * 1024 * 1024;
export const EXPIRATION_DAYS = [1, 7, 30, 90] as const;
const newShareId = customAlphabet('23456789abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ', 10);
const ID_RE = /^[A-Za-z0-9]{6,32}$/;
const DAY_MS = 86_400_000;

/**
 * Content-Security-Policy for the built app: everything from our own origin,
 * inline style attributes (React `style={}`), blob: URLs for downloads/workers.
 */
export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self' ws://127.0.0.1:* ws://localhost:*",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ?? false,
    trustProxy: opts.trustProxy ?? false,
    bodyLimit: MAX_PROJECT_BYTES + 4096,
  });
  const store = opts.store;
  const now = opts.now ?? (() => new Date());
  const salt = opts.hashSalt ?? randomBytes(32).toString('hex');
  const storageLimit = opts.storageLimitBytes ?? DEFAULT_STORAGE_LIMIT;
  const hideAt = opts.reportHideThreshold ?? 3;

  await app.register(rateLimit, { global: false });

  app.addHook('onSend', async (_req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('Content-Security-Policy', CSP);
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Cross-Origin-Opener-Policy', 'same-origin');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    if (opts.hsts) reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  });

  app.get('/api/health', async () => ({ ok: true }));

  // ---------------------------------------------------------------- shares

  app.post(
    '/api/shares',
    { config: { rateLimit: { max: opts.shareRateLimit ?? 20, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const body = req.body as { project?: unknown; expiresInDays?: unknown } | undefined;
      const result = parseProject(body?.project);
      if (!result.ok) return reply.code(400).send({ error: 'invalidProject', message: result.error });
      const days = body?.expiresInDays ?? null;
      if (days !== null && !EXPIRATION_DAYS.includes(days as (typeof EXPIRATION_DAYS)[number]))
        return reply.code(400).send({ error: 'invalidExpiration', message: 'Validade inválida.' });
      const project = result.project;
      const sizeBytes = Buffer.byteLength(JSON.stringify(project));
      if (sizeBytes > MAX_PROJECT_BYTES)
        return reply.code(413).send({ error: 'tooLarge', message: 'Projeto grande demais.' });
      if ((await store.totalBytes()) + sizeBytes > storageLimit)
        return reply
          .code(507)
          .send({ error: 'storageFull', message: 'Armazenamento de links cheio. Tente mais tarde.' });
      const id = newShareId();
      const created = now();
      const expiresAt = typeof days === 'number' ? new Date(created.getTime() + days * DAY_MS) : null;
      await store.create({
        id,
        title: project.meta.name.slice(0, 200),
        project,
        createdAt: created,
        sizeBytes,
        expiresAt,
      });
      return reply.code(201).send({ id, expiresAt: expiresAt?.toISOString() ?? null });
    },
  );

  app.get(
    '/api/shares/:id',
    { config: { rateLimit: { max: 300, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      if (!ID_RE.test(id)) return reply.code(404).send({ error: 'notFound' });
      const rec = await store.get(id);
      if (!rec) return reply.code(404).send({ error: 'notFound' });
      if (rec.expiresAt && rec.expiresAt <= now()) {
        await store.delete(id);
        return reply.code(410).send({ error: 'expired' });
      }
      if (rec.hidden) return reply.code(410).send({ error: 'hidden' });
      // Short cache: a share can still be hidden after reports or expire.
      reply.header('Cache-Control', 'public, max-age=300');
      return {
        id: rec.id,
        title: rec.title,
        createdAt: rec.createdAt.toISOString(),
        expiresAt: rec.expiresAt?.toISOString() ?? null,
        project: rec.project,
      };
    },
  );

  app.post(
    '/api/shares/:id/report',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      if (!ID_RE.test(id)) return reply.code(404).send({ error: 'notFound' });
      const body = req.body as { reason?: unknown; details?: unknown } | undefined;
      if (!REPORT_REASONS.includes(body?.reason as ReportReason))
        return reply.code(400).send({ error: 'invalidReason' });
      const details = typeof body?.details === 'string' ? body.details.trim().slice(0, 500) : undefined;
      // Only a salted hash identifies the reporter: enough to count distinct people, no raw IP stored.
      const reporterHash = createHash('sha256').update(`${salt}:${req.ip}`).digest('hex');
      const r = await store.report(
        { shareId: id, reason: body!.reason as ReportReason, details: details || undefined, reporterHash },
        hideAt,
      );
      if (!r) return reply.code(404).send({ error: 'notFound' });
      if (r.hidden) req.log.warn({ shareId: id, reports: r.reportCount }, 'share hidden after reports');
      return reply.code(202).send({ ok: true });
    },
  );

  // ---------------------------------------------------------------- admin

  if (opts.adminToken) {
    const token = opts.adminToken;
    await app.register(async (admin) => {
      admin.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
        const auth = req.headers.authorization ?? '';
        const given = auth.startsWith('Bearer ') ? auth.slice(7) : '';
        if (!given || !safeEqual(given, token)) return reply.code(401).send({ error: 'unauthorized' });
      });
      admin.get('/api/admin/reports', async () => ({ shares: await store.listReported() }));
      admin.delete('/api/admin/shares/:id', async (req, reply) => {
        const ok = await store.delete((req.params as { id: string }).id);
        return ok ? { ok } : reply.code(404).send({ error: 'notFound' });
      });
      admin.post('/api/admin/shares/:id/restore', async (req, reply) => {
        const ok = await store.setHidden((req.params as { id: string }).id, false);
        return ok ? { ok } : reply.code(404).send({ error: 'notFound' });
      });
      admin.post('/api/admin/shares/:id/hide', async (req, reply) => {
        const ok = await store.setHidden((req.params as { id: string }).id, true);
        return ok ? { ok } : reply.code(404).send({ error: 'notFound' });
      });
    });
  }

  // ---------------------------------------------------------------- cleanup

  const interval = opts.cleanupIntervalMs ?? 3_600_000;
  if (interval > 0) {
    const timer = setInterval(() => {
      store
        .deleteExpired(now())
        .then((n) => n && app.log.info({ removed: n }, 'expired shares removed'))
        .catch((err) => app.log.error(err, 'cleanup failed'));
    }, interval);
    timer.unref();
    app.addHook('onClose', async () => clearInterval(timer));
  }

  // ---------------------------------------------------------------- web app

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

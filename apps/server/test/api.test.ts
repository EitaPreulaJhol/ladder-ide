import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createProject, EXAMPLES } from '@ladder/core';
import { buildApp, CSP, MAX_PROJECT_BYTES } from '../src/app.ts';
import { MemoryShareStore, PgShareStore, type ShareStore } from '../src/store.ts';

const ADMIN = 'test-admin-token-0123456789abcdef';
const stores: [string, () => Promise<ShareStore>][] = [['memory', async () => new MemoryShareStore()]];
if (process.env.TEST_DATABASE_URL)
  stores.push(['postgres', () => PgShareStore.connect(process.env.TEST_DATABASE_URL!)]);

for (const [name, makeStore] of stores) {
  describe(`shares API (${name})`, () => {
    let app: FastifyInstance;
    let store: ShareStore;
    let clock = new Date('2026-11-05T12:00:00Z');
    beforeAll(async () => {
      store = await makeStore();
      app = await buildApp({
        store,
        shareRateLimit: 1000,
        adminToken: ADMIN,
        hashSalt: 'salt',
        cleanupIntervalMs: 0,
        now: () => clock,
      });
    });
    beforeEach(() => {
      clock = new Date('2026-11-05T12:00:00Z');
    });
    afterAll(async () => {
      await app.close();
      await store.close();
    });

    const share = async (extra: Record<string, unknown> = {}) => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/shares',
        payload: { project: EXAMPLES[0]!.build(), ...extra },
      });
      expect(res.statusCode).toBe(201);
      return res.json() as { id: string; expiresAt: string | null };
    };
    const report = (id: string, ip: string, reason = 'spam') =>
      app.inject({ method: 'POST', url: `/api/shares/${id}/report`, payload: { reason }, remoteAddress: ip });
    const admin = (method: 'GET' | 'POST' | 'DELETE', url: string, token = ADMIN) =>
      app.inject({ method, url, headers: { authorization: `Bearer ${token}` } });

    it('creates a snapshot and reads it back', async () => {
      const project = EXAMPLES[0]!.build();
      const res = await app.inject({ method: 'POST', url: '/api/shares', payload: { project } });
      expect(res.statusCode).toBe(201);
      const { id, expiresAt } = res.json();
      expect(id).toMatch(/^[A-Za-z0-9]{10}$/);
      expect(expiresAt).toBeNull();
      const get = await app.inject({ method: 'GET', url: `/api/shares/${id}` });
      expect(get.statusCode).toBe(200);
      expect(get.headers['cache-control']).toBe('public, max-age=300');
      expect(get.json().project).toEqual(JSON.parse(JSON.stringify(project)));
    });

    it('rejects invalid projects and expirations', async () => {
      expect(
        (await app.inject({ method: 'POST', url: '/api/shares', payload: { project: { hello: 1 } } }))
          .statusCode,
      ).toBe(400);
      expect((await app.inject({ method: 'POST', url: '/api/shares', payload: {} })).statusCode).toBe(400);
      const bad = await app.inject({
        method: 'POST',
        url: '/api/shares',
        payload: { project: createProject(), expiresInDays: 5 },
      });
      expect(bad.statusCode).toBe(400);
      expect(bad.json().error).toBe('invalidExpiration');
    });

    it('rejects oversized payloads', async () => {
      const p = createProject();
      p.tags = Array.from({ length: 5000 }, (_, i) => ({
        name: `T${i}`,
        type: 'BOOL' as const,
        comment: 'y'.repeat(300),
      }));
      const res = await app.inject({ method: 'POST', url: '/api/shares', payload: { project: p } });
      expect(JSON.stringify(p).length).toBeGreaterThan(MAX_PROJECT_BYTES);
      expect([400, 413]).toContain(res.statusCode);
    });

    it('returns 404 for unknown or malformed ids', async () => {
      expect((await app.inject({ method: 'GET', url: '/api/shares/doesNotExist1' })).statusCode).toBe(404);
      expect((await app.inject({ method: 'GET', url: '/api/shares/..%2Fetc' })).statusCode).toBe(404);
    });

    it('expires links and cleans them up', async () => {
      const { id, expiresAt } = await share({ expiresInDays: 1 });
      expect(new Date(expiresAt!).getTime() - clock.getTime()).toBe(86_400_000);
      expect((await app.inject({ method: 'GET', url: `/api/shares/${id}` })).statusCode).toBe(200);
      clock = new Date(clock.getTime() + 2 * 86_400_000);
      const gone = await app.inject({ method: 'GET', url: `/api/shares/${id}` });
      expect(gone.statusCode).toBe(410);
      expect(gone.json().error).toBe('expired');
      const other = await share({ expiresInDays: 7 });
      expect(await store.deleteExpired(new Date(clock.getTime() + 8 * 86_400_000))).toBeGreaterThanOrEqual(1);
      expect(await store.get(other.id)).toBeNull();
    });

    it('hides a link after reports from 3 distinct people; duplicates do not count', async () => {
      const { id } = await share();
      expect((await report(id, '10.0.0.1', 'nope')).statusCode).toBe(400);
      expect((await report(id, '10.0.0.1')).statusCode).toBe(202);
      expect((await report(id, '10.0.0.1')).statusCode).toBe(202); // same person again
      expect((await report(id, '10.0.0.2', 'offensive')).statusCode).toBe(202);
      expect((await app.inject({ method: 'GET', url: `/api/shares/${id}` })).statusCode).toBe(200);
      await report(id, '10.0.0.3', 'personalData');
      const hidden = await app.inject({ method: 'GET', url: `/api/shares/${id}` });
      expect(hidden.statusCode).toBe(410);
      expect(hidden.json().error).toBe('hidden');
      expect((await report('doesNotExist1', '10.0.0.9')).statusCode).toBe(404);
    });

    it('admin: auth, list reports, restore, hide and delete', async () => {
      const { id } = await share();
      await report(id, '10.0.1.1', 'spam');
      expect((await app.inject({ method: 'GET', url: '/api/admin/reports' })).statusCode).toBe(401);
      expect((await admin('GET', '/api/admin/reports', 'wrong-token')).statusCode).toBe(401);
      const list = await admin('GET', '/api/admin/reports');
      expect(list.statusCode).toBe(200);
      const entry = list.json().shares.find((s: { id: string }) => s.id === id);
      expect(entry.reportCount).toBe(1);
      expect(entry.reports[0].reason).toBe('spam');
      expect(JSON.stringify(list.json())).not.toContain('10.0.1.1'); // no raw IP anywhere

      expect((await admin('POST', `/api/admin/shares/${id}/hide`)).statusCode).toBe(200);
      expect((await app.inject({ method: 'GET', url: `/api/shares/${id}` })).statusCode).toBe(410);
      expect((await admin('POST', `/api/admin/shares/${id}/restore`)).statusCode).toBe(200);
      expect((await app.inject({ method: 'GET', url: `/api/shares/${id}` })).statusCode).toBe(200);
      const after = (await admin('GET', '/api/admin/reports'))
        .json()
        .shares.find((s: { id: string }) => s.id === id);
      expect(after).toBeUndefined(); // restoring clears the reports

      expect((await admin('DELETE', `/api/admin/shares/${id}`)).statusCode).toBe(200);
      expect((await app.inject({ method: 'GET', url: `/api/shares/${id}` })).statusCode).toBe(404);
      expect((await admin('DELETE', `/api/admin/shares/${id}`)).statusCode).toBe(404);
    });

    it('concurrent creations cannot overshoot the storage limit', async () => {
      const project = createProject();
      const size = Buffer.byteLength(JSON.stringify(project));
      const before = await store.totalBytes();
      const limited = await buildApp({
        store,
        storageLimitBytes: before + size,
        shareRateLimit: 1000,
        cleanupIntervalMs: 0,
      });
      const res = await Promise.all(
        Array.from({ length: 10 }, () =>
          limited.inject({ method: 'POST', url: '/api/shares', payload: { project } }),
        ),
      );
      expect(res.filter((r) => r.statusCode === 201)).toHaveLength(1);
      expect(res.filter((r) => r.statusCode === 507)).toHaveLength(9);
      expect(await store.totalBytes()).toBe(before + size);
      await limited.close();
    });

    it('store quota check and insert are atomic under parallel transactions', async () => {
      // Straight to the store: HTTP parsing staggers requests and hides the race on a fast database.
      const project = createProject();
      // Opens several pool connections first, so the transactions below really run in parallel.
      await Promise.all(Array.from({ length: 8 }, () => store.totalBytes()));
      const before = await store.totalBytes();
      const results = await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          store.create(
            {
              id: `race${Date.now().toString(36)}${i}`,
              title: 'race',
              project,
              createdAt: new Date(),
              sizeBytes: 1000,
              expiresAt: null,
            },
            before + 1000,
          ),
        ),
      );
      expect(results.filter(Boolean)).toHaveLength(1);
      expect(await store.totalBytes()).toBe(before + 1000);
    });

    it('sends security headers', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/health' });
      expect(res.headers['content-security-policy']).toBe(CSP);
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['strict-transport-security']).toBeUndefined();
    });
  });
}

describe('limits and configuration', () => {
  it('limits share creation per IP', async () => {
    const app = await buildApp({ store: new MemoryShareStore(), shareRateLimit: 2, cleanupIntervalMs: 0 });
    const project = createProject();
    const codes: number[] = [];
    for (let i = 0; i < 3; i++)
      codes.push((await app.inject({ method: 'POST', url: '/api/shares', payload: { project } })).statusCode);
    expect(codes).toEqual([201, 201, 429]);
    await app.close();
  });

  it('refuses new shares when the storage limit is reached', async () => {
    const size = Buffer.byteLength(JSON.stringify(createProject()));
    const app = await buildApp({
      store: new MemoryShareStore(),
      storageLimitBytes: size * 1.5,
      cleanupIntervalMs: 0,
    });
    const post = () =>
      app.inject({ method: 'POST', url: '/api/shares', payload: { project: createProject() } });
    expect((await post()).statusCode).toBe(201);
    const full = await post();
    expect(full.statusCode).toBe(507);
    expect(full.json().error).toBe('storageFull');
    await app.close();
  });

  it('X-Forwarded-For is only honored from trusted proxies', async () => {
    const app = await buildApp({
      store: new MemoryShareStore(),
      trustProxy: ['10.0.0.1'],
      shareRateLimit: 1000,
      cleanupIntervalMs: 0,
    });
    const { id } = (
      await app.inject({ method: 'POST', url: '/api/shares', payload: { project: createProject() } })
    ).json();
    const report = (xff: string, remoteAddress: string) =>
      app.inject({
        method: 'POST',
        url: `/api/shares/${id}/report`,
        payload: { reason: 'spam' },
        headers: { 'x-forwarded-for': xff },
        remoteAddress,
      });
    // Spoofed header straight from a client: all reports count as one person.
    for (const xff of ['1.1.1.1', '2.2.2.2', '3.3.3.3']) await report(xff, '9.9.9.9');
    expect((await app.inject({ method: 'GET', url: `/api/shares/${id}` })).statusCode).toBe(200);
    // Through the trusted proxy the forwarded client IP is used.
    for (const xff of ['4.4.4.4', '5.5.5.5']) await report(xff, '10.0.0.1');
    expect((await app.inject({ method: 'GET', url: `/api/shares/${id}` })).statusCode).toBe(410);
    await app.close();
  });

  it('throttles admin requests, failed logins included', async () => {
    const app = await buildApp({
      store: new MemoryShareStore(),
      adminToken: ADMIN,
      adminRateLimit: 3,
      cleanupIntervalMs: 0,
    });
    const codes = [];
    for (let i = 0; i < 4; i++)
      codes.push(
        (
          await app.inject({
            method: 'GET',
            url: '/api/admin/reports',
            headers: { authorization: 'Bearer wrong-token' },
          })
        ).statusCode,
      );
    expect(codes).toEqual([401, 401, 401, 429]);
    await app.close();
  });

  it('strips invisible characters from shared titles', async () => {
    const store = new MemoryShareStore();
    const app = await buildApp({ store, cleanupIntervalMs: 0 });
    const project = createProject();
    project.meta.name = 'Aula\u202E\u200B 1\u0007';
    const { id } = (await app.inject({ method: 'POST', url: '/api/shares', payload: { project } })).json();
    expect((await store.get(id))!.title).toBe('Aula 1');
    await app.close();
  });

  it('admin routes do not exist without a token; HSTS is opt-in', async () => {
    const app = await buildApp({ store: new MemoryShareStore(), cleanupIntervalMs: 0, hsts: true });
    expect((await app.inject({ method: 'GET', url: '/api/admin/reports' })).statusCode).toBe(404);
    expect(
      (await app.inject({ method: 'GET', url: '/api/health' })).headers['strict-transport-security'],
    ).toContain('max-age');
    await app.close();
  });
});

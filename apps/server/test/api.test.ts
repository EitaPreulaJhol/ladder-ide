import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createProject, EXAMPLES } from '@ladder/core';
import { buildApp, MAX_PROJECT_BYTES } from '../src/app.ts';
import { MemoryShareStore, PgShareStore, type ShareStore } from '../src/store.ts';

const stores: [string, () => Promise<ShareStore>][] = [['memory', async () => new MemoryShareStore()]];
if (process.env.TEST_DATABASE_URL)
  stores.push(['postgres', () => PgShareStore.connect(process.env.TEST_DATABASE_URL!)]);

for (const [name, makeStore] of stores) {
  describe(`shares API (${name})`, () => {
    let app: FastifyInstance;
    let store: ShareStore;
    beforeAll(async () => {
      store = await makeStore();
      app = await buildApp({ store, shareRateLimit: 1000 });
    });
    afterAll(async () => {
      await app.close();
      await store.close();
    });

    it('creates an immutable snapshot and reads it back', async () => {
      const project = EXAMPLES[0]!.build();
      const res = await app.inject({ method: 'POST', url: '/api/shares', payload: { project } });
      expect(res.statusCode).toBe(201);
      const { id } = res.json();
      expect(id).toMatch(/^[A-Za-z0-9]{10}$/);
      const get = await app.inject({ method: 'GET', url: `/api/shares/${id}` });
      expect(get.statusCode).toBe(200);
      expect(get.headers['cache-control']).toContain('immutable');
      expect(get.json().project).toEqual(JSON.parse(JSON.stringify(project)));
    });

    it('rejects invalid projects', async () => {
      const bad = await app.inject({
        method: 'POST',
        url: '/api/shares',
        payload: { project: { hello: 1 } },
      });
      expect(bad.statusCode).toBe(400);
      const none = await app.inject({ method: 'POST', url: '/api/shares', payload: {} });
      expect(none.statusCode).toBe(400);
    });

    it('rejects oversized payloads', async () => {
      const p = createProject();
      p.meta.description = 'x'.repeat(4000);
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
  });
}

describe('rate limiting', () => {
  it('limits share creation per IP', async () => {
    const store = new MemoryShareStore();
    const app = await buildApp({ store, shareRateLimit: 2 });
    const project = createProject();
    const codes: number[] = [];
    for (let i = 0; i < 3; i++)
      codes.push((await app.inject({ method: 'POST', url: '/api/shares', payload: { project } })).statusCode);
    expect(codes).toEqual([201, 201, 429]);
    await app.close();
  });
});

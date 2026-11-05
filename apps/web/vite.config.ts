import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

/** Emits sw.js with the exact list of built files, so the app works offline. */
function offlineServiceWorker(): Plugin {
  return {
    name: 'ladder-offline-sw',
    apply: 'build',
    generateBundle(_options, bundle) {
      const built = Object.keys(bundle).filter((f) => !f.endsWith('.map'));
      const files = [
        '/',
        '/index.html',
        '/favicon.svg',
        '/manifest.webmanifest',
        '/icon-192.png',
        '/icon-512.png',
        ...built.filter((f) => f !== 'index.html').map((f) => `/${f}`),
      ];
      const version = createHash('sha256').update(built.sort().join('|')).digest('hex').slice(0, 12);
      const template = readFileSync(new URL('./sw-template.js', import.meta.url), 'utf8');
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: template
          .replace('__VERSION__', version)
          .replace('__FILES__', JSON.stringify([...new Set(files)])),
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), offlineServiceWorker()],
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://localhost:3000', changeOrigin: true } },
  },
  worker: { format: 'es' },
});

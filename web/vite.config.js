import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:5174',
        changeOrigin: true,
        // Network-path git ops can be slow; keep proxy open long enough for
        // server-side timeouts to fire and return a real error instead of a
        // vague proxy disconnect.
        timeout: 120_000,
        proxyTimeout: 120_000,
        configure: (proxy) => {
          proxy.on('error', (err, _req, res) => {
            console.error('[vite proxy /api]', err.message);
            if (res && !res.headersSent) {
              res.writeHead(502, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                error: `后端不可达（${err.message}）。请确认 server 在 5174 端口运行。`,
              }));
            }
          });
        },
      },
    },
  },
});

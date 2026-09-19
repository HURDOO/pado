import { createServer } from 'node:http';
import { createServer as createVite } from 'vite';
import react from '@vitejs/plugin-react';
import { createApi } from './api.mjs';

const api = createApi(process.env.QA_DB || 'data/questions.sqlite');
let vite;
const server = createServer((req, res) => {
  if (req.url?.startsWith('/api/')) void api.handle(req, res);
  else vite.middlewares(req, res);
});
vite = await createVite({
  plugins: [react()],
  server: { middlewareMode: true, hmr: { server }, watch: { usePolling: true, interval: 250 } },
  appType: 'spa',
});
server.listen(Number(process.env.PORT || 3000), '0.0.0.0', () => console.log('LIVE_QA_READY — React + Vite + Node + SQLite'));
const stop = async () => { await vite.close(); server.close(() => { api.close(); process.exit(0); }); };
process.once('SIGTERM', stop);
process.once('SIGINT', stop);

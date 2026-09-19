import { createServer } from 'node:http';
import { createServer as createVite } from 'vite';
import { createApi } from './api.ts';

const api = createApi(process.env.DESK_DB || 'data/desk.sqlite');
const server = createServer((req, res) => {
  if (req.url?.startsWith('/api/')) void api.handle(req, res);
  else vite.middlewares(req, res);
});
const vite = await createVite({
  server: { middlewareMode: true, hmr: { server } },
  appType: 'spa',
});
server.listen(Number(process.env.PORT || 3000), '0.0.0.0', () =>
  console.log('HACKATHON_DESK_READY'),
);
let closing = false;
async function stop() {
  if (closing) return;
  closing = true;
  await vite.close();
  server.close(() => {
    api.close();
    process.exit(0);
  });
  server.closeAllConnections();
}
process.once('SIGTERM', stop);
process.once('SIGINT', stop);

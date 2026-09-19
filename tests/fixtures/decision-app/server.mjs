import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

export function render() {
  const settings = JSON.parse(readFileSync(new URL('./settings.json', import.meta.url), 'utf8'));
  if (!['cards', 'list'].includes(settings.layout)) throw new Error('Choose a layout first');
  const rows = ['노트북 연결이 안 돼요', '발표 순서가 궁금해요'];
  return `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>질문 보드</title><style>body{background:#10151e;color:#eef4ff;font:16px/1.6 system-ui;padding:20px;margin:0}section{display:grid;gap:12px;grid-template-columns:${settings.layout === 'cards' ? 'repeat(auto-fit,minmax(240px,1fr))' : '1fr'}}article{padding:16px;border:1px solid #42608a;border-radius:${settings.layout === 'cards' ? '16px' : '4px'}}small{color:#80b5ff}</style><h1>질문 보드</h1><p data-layout="${settings.layout}">${settings.layout === 'cards' ? '카드형' : '목록형'}</p><section>${rows.map((row) => `<article><strong>${row}</strong><br><small>접수됨</small></article>`).join('')}</section></html>`;
}
if (process.argv[1] === new URL(import.meta.url).pathname) {
  createServer((_req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(render());
  }).listen(3000, '0.0.0.0');
}

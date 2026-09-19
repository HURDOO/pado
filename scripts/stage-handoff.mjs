import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const [mode, file] = process.argv.slice(2);
if (!['backup', 'restore'].includes(mode) || !file)
  throw new Error('Usage: stage-handoff.mjs backup|restore .pado/filename.json');
const origin = process.env.PADO_ORIGIN;
if (!origin || !/^http:\/\/(127\.0\.0\.1|192\.168\.10\.13):4173$/.test(origin))
  throw new Error('Local Pado origin required');
let cookie = '';
async function post(path, value = {}) {
  const result = await fetch(origin + '/api/' + path, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(value),
  });
  const data = await result.json();
  if (!result.ok) throw new Error('Stage request failed: ' + result.status);
  if (result.headers.has('set-cookie')) cookie = result.headers.get('set-cookie').split(';')[0];
  return data;
}
const snapshot = await post('join', { nickname: 'TUI 전환 확인' });
if (snapshot.stage.turn || snapshot.stage.speaker)
  throw new Error('Stage is active; do not restart');
if (mode === 'backup') {
  await writeFile(
    resolve(file),
    JSON.stringify({ panes: snapshot.stage.panes, focusId: snapshot.stage.focusId }, null, 2),
    { flag: 'wx', mode: 0o600 },
  );
  console.log('Saved public panes:', snapshot.stage.panes.length);
} else {
  if (!process.env.PADO_ADMIN_PASSWORD) throw new Error('Administrator secret required');
  await post('admin/login', { password: process.env.PADO_ADMIN_PASSWORD });
  const backup = JSON.parse(await readFile(resolve(file), 'utf8'));
  for (const pane of backup.panes) await post('admin/present', { type: 'pane.upsert', pane });
  await post('admin/present', { type: 'pane.focus', id: 'agent' });
  console.log('Restored public panes:', backup.panes.length);
}

import { appendFileSync, readFileSync, realpathSync, statSync, unlinkSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { bindCommandWait } from './command-wait.mjs';

const [mode, paneId, ...args] = process.argv.slice(2);
const validId = (value) => /^[a-zA-Z0-9_-]{1,64}$/.test(value || '');
const emit = (value) => {
  if (
    value.type?.startsWith('terminal.') ||
    (value.type === 'pane.upsert' && (value.pane?.kind === 'terminal' || value.pane?.terminal))
  )
    throw new Error(
      'Terminal output is process-owned. Use exec, run or serve to stream a real command; use pane.show to restore its log.',
    );
  const line = JSON.stringify(value);
  if (line.length > 75_000) throw new Error('Presentation event is too large');
  if (value.type === 'pane.upsert' && value.pane?.kind === 'input' && validId(value.pane.id)) {
    try {
      unlinkSync(`/bridge/${value.pane.id}.error.json`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  appendFileSync('/bridge/events.ndjson', line + '\n', { encoding: 'utf8', mode: 0o600 });
};
if (['exec', 'run', 'serve', 'stop-server', 'secrets'].includes(mode)) {
  if (mode !== 'secrets' && !/^[a-zA-Z0-9_-]{1,48}$/.test(paneId || ''))
    throw new Error('Runtime ID must be 1-48 letters, digits, - or _.');
  const command = [...args];
  const port = mode === 'serve' ? Number(command.shift()) : undefined;
  if (mode === 'serve' && ![3000, 3001, 5173, 8080].includes(port))
    throw new Error('Use sandbox port 3000, 3001, 5173, or 8080.');
  let cwd = '.';
  let quiet = false;
  let show = false;
  let secrets;
  while (['--quiet', '--show', '--cwd', '--secrets'].includes(command[0])) {
    const option = command.shift();
    if (option === '--quiet') quiet = true;
    else if (option === '--show') show = true;
    else if (option === '--cwd') cwd = command.shift();
    else {
      secrets = command.shift()?.split(',');
      if (
        !secrets?.length ||
        secrets.length > 20 ||
        new Set(secrets).size !== secrets.length ||
        secrets.some((name) => !/^[A-Z][A-Z0-9_]{0,79}$/.test(name))
      )
        throw new Error(
          'Use --secrets NAME,OTHER_NAME with environment variable names only, never values.',
        );
    }
  }
  if (
    !cwd ||
    !/^(?:\.|[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_.-]+)*)$/.test(cwd) ||
    cwd.split('/').includes('..')
  )
    throw new Error('Use a relative workspace directory.');
  if (!['stop-server', 'secrets'].includes(mode) && !command.length)
    throw new Error('Provide a command and arguments; no host shell is used.');
  if (quiet && show) throw new Error('Choose --quiet or --show, not both.');
  const requestId = randomUUID();
  const waitFor =
    !quiet && !show && ['exec', 'run'].includes(mode)
      ? bindCommandWait([mode, paneId, ...args])
      : undefined;
  appendFileSync(
    '/bridge/runtime.ndjson',
    JSON.stringify({
      requestId,
      action: mode === 'stop-server' ? 'stop' : mode,
      id: mode === 'secrets' ? 'secret-status' : paneId,
      display: mode === 'serve' || show ? 'terminal' : quiet ? 'none' : 'waiting',
      ...(waitFor ? { waitFor } : {}),
      ...(port ? { port } : {}),
      cwd,
      ...(secrets ? { secrets } : {}),
      ...(command.length ? { command } : {}),
    }) + '\n',
    { mode: 0o600 },
  );
  const deadline = Date.now() + 240000;
  let result;
  while (Date.now() < deadline) {
    try {
      result = JSON.parse(readFileSync(`/bridge/${requestId}.runtime.json`, 'utf8'));
      break;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    await delay(200);
  }
  if (!result) throw new Error('App runtime response timed out.');
  console.log(JSON.stringify(result));
  if (result.ok && mode === 'serve')
    emit({
      type: 'pane.upsert',
      pane: {
        id: paneId,
        kind: 'browser',
        title: '실행 중인 앱',
        subtitle: `Sandbox server · :${port}`,
        server: { port, path: '/' },
        content: '',
        size: 2,
        status: 'active',
      },
    });
  if (!result.ok) process.exitCode = 1;
} else if (mode === 'wait') {
  if (!validId(paneId)) throw new Error('Usage: wait PANE_ID');
  const deadline = Date.now() + 180_000;
  let answered = false;
  while (Date.now() < deadline) {
    try {
      try {
        const failure = JSON.parse(readFileSync(`/bridge/${paneId}.error.json`, 'utf8'));
        throw new Error(
          `Input UI failed: ${String(failure.message).slice(0, 300)}. Fix the HTML, publish the input pane again, and wait for the user. Use --file to avoid shell quoting errors.`,
        );
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      const response = readFileSync(`/bridge/${paneId}.answer.json`, 'utf8');
      console.log(response);
      // Keep stdout as the exact answer JSON for existing consumers. Tool feedback belongs on stderr.
      console.error(
        'If this task has a Context pane, update that SAME pane now with the actual confirmed choice and its source before implementing. Replace the pending choice; do not leave the working criteria at the pre-answer state. Never include secret values.',
      );
      answered = true;
      break;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    await delay(250);
  }
  if (!answered) throw new Error('Input timed out');
} else if (mode === '--file') {
  if (!paneId) throw new Error('Usage: --file /workspace/event.json');
  const file = realpathSync(resolve('/workspace', paneId));
  if (
    !file.startsWith('/workspace' + sep) ||
    !statSync(file).isFile() ||
    statSync(file).size > 80_000
  )
    throw new Error('Presentation JSON must be a small regular file inside /workspace');
  const event = JSON.parse(readFileSync(file, 'utf8'));
  emit(event);
  console.log(
    `Presentation queued: ${event.type} ${event.pane?.id ?? event.id ?? ''}. Reuse this pane ID for updates; do not create duplicate copies.`,
  );
} else {
  const event = JSON.parse(mode);
  emit(event);
  console.log(
    `Presentation queued: ${event.type} ${event.pane?.id ?? event.id ?? ''}. Reuse this pane ID for updates; do not create duplicate copies.`,
  );
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createHmac, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { resolve } from 'node:path';
import { AppRuntime } from '../server/app-runtime.ts';
import { runtimeRequestSchema } from '../shared/protocol.ts';
import type { TerminalEvent } from '../server/terminal-events.ts';
import { StageStore } from '../server/stage.ts';
import { ProjectSecrets } from '../server/project-secrets.ts';

test(
  'project secrets reach only named app executions and never appear in returned/streamed output',
  { timeout: 60000 },
  async () => {
    const root = resolve('.pado/runtime-smoke', randomUUID());
    const workspace = resolve(root, 'workspace');
    await mkdir(workspace, { recursive: true });
    const secrets = new ProjectSecrets(root);
    const value = 'DEMO-ONLY-' + randomUUID();
    await secrets.set('DEMO_API_KEY', value);
    await secrets.set('OTHER_API_KEY', 'demo-other-not-requested');
    const runtime = new AppRuntime(secrets);
    const events: TerminalEvent[] = [];
    const execute = (action: string, command?: string[], names?: string[]) =>
      runtime.execute(
        runtimeRequestSchema.parse({
          requestId: randomUUID(),
          id: 'secret-check',
          action,
          command,
          secrets: names,
        }),
        workspace,
        (event) => events.push(event),
      );
    try {
      const listing = await execute('secrets');
      assert.deepEqual(JSON.parse(listing.output!), { names: ['DEMO_API_KEY', 'OTHER_API_KEY'] });
      assert.equal(events.length, 0);
      const plain = await execute('exec', [
        'node',
        '-e',
        'if(process.env.DEMO_API_KEY)process.exit(1);console.log("NO_INJECTION")',
      ]);
      assert.equal(plain.ok, true);
      const missing = await execute(
        'exec',
        ['node', '-e', 'console.log("SHOULD_NOT_RUN")'],
        ['MISSING_KEY'],
      );
      assert.equal(missing.ok, false);
      assert.match(missing.error!, /MISSING_KEY/);
      const digest = createHmac('sha256', value).update('pado-test').digest('hex');
      const result = await execute(
        'exec',
        [
          'node',
          '-e',
          `
      const assert=require('node:assert/strict');
      const key=process.env.DEMO_API_KEY;
      assert.equal(require('node:crypto').createHmac('sha256',key).update('pado-test').digest('hex'),'${digest}');
      assert.equal(process.env.OTHER_API_KEY,undefined);
      for(const file of ['/auth','/bridge/runtime.ndjson','/workspace/secrets.json'])assert.equal(require('node:fs').existsSync(file),false);
      console.log('SECRET_INJECTION_OK');
      process.stdout.write(key.slice(0,7));
      setTimeout(()=>{process.stdout.write(key.slice(7)+'\\n');console.error(key)},30);
    `,
        ],
        ['DEMO_API_KEY'],
      );
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.match(result.output!, /SECRET_INJECTION_OK/);
      assert.match(result.output!, /\[REDACTED\]/);
      assert.equal(JSON.stringify({ events, result, listing }).includes(value), false);
      await secrets.set('DEMO_API_KEY', 'changed-demo-value');
      const updated = await execute(
        'exec',
        [
          'node',
          '-e',
          'if(process.env.DEMO_API_KEY.length!==18)process.exit(1);console.log("UPDATED")',
        ],
        ['DEMO_API_KEY'],
      );
      assert.equal(updated.ok, true, JSON.stringify(updated));
    } finally {
      await runtime.stop();
    }
  },
);

test(
  'real command streams before exit, continues while hidden, and keeps its observed failure code',
  { timeout: 60000 },
  async () => {
    const runtime = new AppRuntime();
    const store = new StageStore();
    const workspace = resolve('.pado/runtime-smoke', randomUUID());
    await mkdir(workspace, { recursive: true });
    const request = runtimeRequestSchema.parse({
      requestId: randomUUID(),
      id: 'stream-proof',
      action: 'run',
      command: [
        'node',
        '-e',
        'console.log("BEFORE_EXIT");setTimeout(()=>{console.error("AFTER_HIDE");process.exit(7)},1200)',
      ],
    });
    try {
      const pending = runtime.execute(request, workspace, (event) => store.terminal(event));
      for (let n = 0; n < 200 && !store.state.panes[0]?.content.includes('BEFORE_EXIT'); n++)
        await delay(25);
      assert.match(store.state.panes[0].content, /BEFORE_EXIT/);
      assert.equal(store.state.panes[0].status, 'active');
      assert.equal(store.state.panes[0].terminal?.finishedAt, undefined);
      assert.deepEqual(store.state.panes[0].terminal?.command, request.command);
      assert.equal(store.state.panes[0].terminal?.cwd, '.');
      store.present({ type: 'pane.close', id: request.id });
      const result = await pending;
      assert.equal(result.code, 7);
      assert.equal(store.state.panes.length, 0);
      assert.equal(store.state.focusId, 'agent');
      store.present({ type: 'pane.show', id: request.id });
      assert.match(store.state.panes[0].content, /\[stderr\] AFTER_HIDE/);
      assert.equal(store.state.panes[0].terminal?.code, 7);
      assert.equal(store.state.panes[0].terminal?.runId, request.requestId);
      assert.equal(store.state.panes[0].status, 'error');
    } finally {
      await runtime.stop();
    }
  },
);

test(
  'real app container has no credentials; server is loopback-published and stops cleanly',
  { timeout: 60000 },
  async () => {
    const runtime = new AppRuntime();
    const workspace = resolve('.pado/runtime-smoke', randomUUID());
    await mkdir(workspace, { recursive: true });
    const events: TerminalEvent[] = [];
    const execute = (action: string, command: string[], display = 'terminal') =>
      runtime.execute(
        runtimeRequestSchema.parse({
          requestId: randomUUID(),
          id: 'app',
          action,
          port: 3000,
          command,
          display,
        }),
        workspace,
        (event) => events.push(event),
      );
    try {
      const checked = await execute(
        'exec',
        [
          'node',
          '-e',
          `const fs=require('node:fs'); const assert=require('node:assert/strict'); for (const p of ['/auth','/var/run/docker.sock','/home/node/.gemini/antigravity-cli/auth.json','/bridge/runtime.ndjson']) assert.equal(fs.existsSync(p),false,p); assert.equal(process.getuid(),1000); console.log('NO_APP_CREDENTIALS');`,
        ],
        'none',
      );
      assert.equal(checked.ok, true, JSON.stringify(checked));
      assert.match(checked.output!, /NO_APP_CREDENTIALS/);
      assert.equal(events.length, 0, 'an explicit quiet command never creates or updates a pane');
      const failed = await execute('exec', [
        'node',
        '-e',
        'console.error("EXPECTED_FAILURE");process.exit(2)',
      ]);
      assert.equal(failed.ok, false);
      assert.equal(failed.code, 2);
      assert.match(failed.output!, /EXPECTED_FAILURE/);
      assert.ok(
        events.some(
          (event) =>
            event.type === 'terminal.append' &&
            event.stream === 'stderr' &&
            event.text.includes('EXPECTED_FAILURE'),
        ),
      );
      assert.ok(events.some((event) => event.type === 'terminal.exit' && event.code === 2));
      const startIndex = events.length;
      const started = await execute(
        'serve',
        [
          'node',
          '-e',
          `[3000,3001,5173,8080].forEach(port=>require('node:http').createServer((req,res)=>res.end('APP '+port+req.url)).listen(port,'0.0.0.0'))`,
        ],
        'none',
      );
      assert.equal(started.ok, true, JSON.stringify(started));
      const target = runtime.target(3000)!;
      for (const port of [3000, 3001, 5173, 8080]) {
        const mapping = runtime.target(port)!;
        assert.equal(mapping.host, '127.0.0.1');
        assert.equal(
          await (await fetch('http://' + mapping.host + ':' + mapping.port + '/real')).text(),
          'APP ' + port + '/real',
        );
      }
      const serverEvents = events.slice(startIndex);
      assert.equal(
        serverEvents[0].type,
        'terminal.open',
        'even legacy quiet serve requests publish startup',
      );
      assert.ok(serverEvents.some((event) => event.type === 'terminal.ready'));
      assert.equal(
        serverEvents.some((event) => event.type === 'terminal.exit'),
        false,
        'ready is still a running server',
      );
      await runtime.stop();
      assert.equal(runtime.target(3000), undefined);
      assert.equal(runtime.state, 'stopped');
      await assert.rejects(fetch('http://' + target.host + ':' + target.port));
    } finally {
      await runtime.stop();
    }
  },
);

test(
  'stop during app Docker creation never leaves a running server',
  { timeout: 60000 },
  async () => {
    const runtime = new AppRuntime();
    const workspace = resolve('.pado/runtime-smoke', randomUUID());
    await mkdir(workspace, { recursive: true });
    const starting = runtime.execute(
      runtimeRequestSchema.parse({
        requestId: randomUUID(),
        id: 'canceled',
        action: 'serve',
        port: 3000,
        command: ['node', '-e', 'setInterval(()=>{},1000)'],
      }),
      workspace,
      () => {},
    );
    await runtime.stop();
    assert.equal((await starting).ok, false);
    assert.equal(runtime.state, 'stopped');
    assert.equal(runtime.target(3000), undefined);
  },
);

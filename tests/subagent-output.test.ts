import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { SubagentOutputSnapshot } from '../server/subagent-output.ts';
import { plainSubagentLog, styledSubagentLog } from '../web/src/subagent-log.ts';

const { SubagentOutputObserver, renderSubagentOutput } = await import(
  new URL('../agent/subagent-output.mjs', import.meta.url).href
);

test('child TUI shows public responses and selected tool details, not thoughts/prompts/raw results', () => {
  const output = renderSubagentOutput([
    { source: 'USER_EXPLICIT', type: 'USER_INPUT', content: 'PRIVATE_PROMPT' },
    { source: 'TOOL', type: 'GENERIC', content: 'PRIVATE_DIAGNOSTIC' },
    {
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      content: '파일을 확인했습니다.',
      thinking: 'PRIVATE_THOUGHT',
      tool_calls: [
        { name: 'view_file', args: { path: '/Users/private/PRIVATE_PATH' } },
        { name: 'PRIVATE_TOOL_NAME' },
      ],
    },
  ]);
  assert.match(output, /파일을 확인했습니다/);
  assert.match(output, /┌─ READ/);
  assert.match(output, /┌─ TOOL/);
  assert.doesNotMatch(output, /PRIVATE|args|thinking/);
});

const call = (name: string, args = {}) => ({
  source: 'MODEL',
  type: 'PLANNER_RESPONSE',
  tool_calls: [{ name, args }],
});
const result = (content: string, status = 'DONE') => ({
  source: 'MODEL',
  type: 'GENERIC',
  status,
  content: `Created At: now\nCompleted At: now\n${content}`,
});

test('TUI blocks show summaries, workspace paths, line ranges and actual completion', () => {
  const rows = [
    call('view_file', {
      AbsolutePath: '/workspace/src/App.tsx',
      StartLine: 10,
      EndLine: 45,
      toolSummary: '모바일 버튼 구조 확인',
    }),
  ];
  const pending = renderSubagentOutput(rows);
  assert.match(pending, /READ  src\/App.tsx:10–45\n│ 모바일 버튼 구조 확인\n└─ · 결과 대기/);
  assert.doesNotMatch(pending, /완료|✓/);
  const completed = renderSubagentOutput([...rows, result('PRIVATE_FILE_CONTENT')]);
  assert.match(completed, /✓ 파일 읽기 완료/);
  assert.doesNotMatch(completed, /PRIVATE|Created At/);
  assert.match(
    renderSubagentOutput([call('find_by_name'), result('Found 3 results')]),
    /검색 완료 · 3개/,
  );
});

test('native JSON-encoded arguments decode paths, line numbers and message newlines before filtering', () => {
  const output = renderSubagentOutput([
    call('view_file', {
      AbsolutePath: JSON.stringify('/workspace/src/App.tsx'),
      StartLine: '1',
      EndLine: '20',
      toolSummary: JSON.stringify('버튼 확인'),
    }),
    result('file content'),
    call('send_message', { Message: JSON.stringify('첫 줄\n둘째 줄\nAPI_KEY=PRIVATE_ENCODED') }),
    result('sent'),
    call('send_message', { Message: '"첫 줄\\n둘째 줄\\n<truncated 100 bytes>' }),
  ]);
  assert.match(output, /READ  src\/App.tsx:1–20\n│ 버튼 확인/);
  assert.match(output, /│ 첫 줄\n│ 둘째 줄/);
  assert.match(output, /기록 일부 생략/);
  assert.doesNotMatch(output, /PRIVATE|\\n|"\/workspace/);
});

test('message bodies and completed diff excerpts are visible without routing or tool instructions', () => {
  const output = renderSubagentOutput([
    call('send_message', {
      Message: '모바일 버튼을 확인했습니다.',
      Recipient: 'PRIVATE_RECIPIENT',
      toolSummary: '진행 상황 전달',
    }),
    result('Message sent to PRIVATE_RECIPIENT'),
    call('replace_file_content', {
      TargetFile: '/workspace/src/App.tsx',
      ReplacementContent: 'UNCONFIRMED_CHANGE',
    }),
    result(
      'The following changes were made. PRIVATE_INSTRUCTION\n[diff_block_start]\n@@ -1 +1 @@\n-old button\n+new button\n[diff_block_end]\nPRIVATE_TRAILER',
    ),
  ]);
  assert.match(output, /MESSAGE\n│ 진행 상황 전달\n│ 모바일 버튼을 확인했습니다/);
  assert.match(output, /메시지 전달 완료/);
  assert.match(output, /EDIT  src\/App.tsx/);
  assert.match(output, /│ -old button\n│ \+new button/);
  assert.doesNotMatch(output, /PRIVATE|UNCONFIRMED/);
});

test('command output unwraps workspace helper results and uses its real exit code', () => {
  const output = renderSubagentOutput([
    call('run_command', { CommandLine: 'pnpm test', toolSummary: '회귀 테스트 실행' }),
    result(
      'The command exited with code 0.\nOutput:\n' +
        JSON.stringify({
          ok: false,
          code: 1,
          output:
            'Tests: 1 failed, 12 passed\nAPI_KEY=PRIVATE_CREDENTIAL\n/Users/private/source.ts',
        }),
    ),
  ]);
  assert.match(output, /RUN  pnpm test/);
  assert.match(output, /Tests: 1 failed, 12 passed/);
  assert.match(output, /! 종료 코드 1/);
  assert.doesNotMatch(output, /PRIVATE|Created At|✓/);
  const stack = renderSubagentOutput([
    call('run_command'),
    result(
      'The command exited with code 2.\nOutput:\nError: PRIVATE_DIAGNOSTIC\n    at /opt/cli/main.js',
    ),
  ]);
  assert.match(stack, /상세 출력 비공개/);
  assert.match(stack, /종료 코드 2/);
  assert.doesNotMatch(stack, /PRIVATE|opt\/cli/);
});

test('errors, running calls, missing results and ambiguous parallel calls never become successes', () => {
  assert.match(
    renderSubagentOutput([
      call('view_file'),
      result('Encountered error: Permission denied PRIVATE_DETAIL'),
    ]),
    /! 권한 거부/,
  );
  assert.match(
    renderSubagentOutput([call('run_command'), result('PRIVATE_DETAIL', 'ERROR')]),
    /! 도구 실행 오류/,
  );
  assert.match(
    renderSubagentOutput([call('run_command'), result('PRIVATE_DETAIL', 'RUNNING')]),
    /· 실행 중/,
  );
  assert.match(
    renderSubagentOutput([call('run_command'), result('UNKNOWN_RESULT')]),
    /종료 코드 미확인/,
  );
  const parallel = renderSubagentOutput([
    { ...call('view_file'), tool_calls: [{ name: 'view_file' }, { name: 'run_command' }] },
    result('The command exited with code 0.\nOutput:\nPRIVATE_AMBIGUOUS'),
  ]);
  assert.equal((parallel.match(/결과 대기/g) ?? []).length, 2);
  assert.doesNotMatch(parallel, /✓|PRIVATE/);
});

test('unknown tools, unsafe targets and sensitive command outputs stay private', () => {
  const output = renderSubagentOutput([
    call('define_subagent', { toolSummary: 'PRIVATE_PROMPT', system_prompt: 'PRIVATE_SYSTEM' }),
    result('PRIVATE_RESULT'),
    ...[
      '/workspace/../PRIVATE_FILE',
      '/workspace/.env',
      '/workspace2/PRIVATE_FILE',
      '/Users/PRIVATE_FILE',
    ].flatMap((path) => [call('view_file', { AbsolutePath: path }), result('PRIVATE_CONTENT')]),
    call('run_command', { CommandLine: 'printenv' }),
    result('The command exited with code 0.\nOutput:\nPRIVATE_ENV'),
    call('run_command', { CommandLine: 'deploy --token PRIVATE_TOKEN' }),
  ]);
  assert.doesNotMatch(output, /PRIVATE|\.env|workspace2/);
  assert.match(output, /상세 출력 비공개/);
});

test('long diffs and responses are bounded and visibly marked as excerpts', () => {
  const output = renderSubagentOutput([
    call('replace_file_content', { TargetFile: '/workspace/app.ts' }),
    result('[diff_block_start]\n' + '+line\n'.repeat(100)),
  ]);
  assert.match(output, /일부 생략/);
  assert.ok(output.length < 2500);
  const long = renderSubagentOutput([
    { source: 'MODEL', type: 'PLANNER_RESPONSE', content: 'x'.repeat(20_000) },
  ]);
  assert.equal(long.length, 16_000);
  assert.match(long, /^… 이전 로그 생략/);
});

test('client adds only trusted colors after stripping terminal controls', () => {
  const text =
    '┌─ READ  src/App.tsx\n│ +added\n└─ ✓ 파일 읽기 완료\n└─ ! 종료 코드 1\n└─ · 결과 대기\n◆ RESPONSE';
  const styled = styledSubagentLog(text + '\x1b[2J\x1b]52;c;PRIVATE\x07\u202e');
  assert.equal(plainSubagentLog(styled), text);
  assert.ok(styled.includes('\x1b[1;38;2;142;186;255m'));
  assert.ok(styled.includes('\x1b[38;2;131;206;164m'));
  assert.doesNotMatch(styled, /PRIVATE|\[2J|\]52|\u202e/);
});

test('terminal controls, known credentials and host paths are removed and output is bounded', () => {
  const content =
    '\x1b]52;c;c2VjcmV0\x07hello\x1b[31m\r\x00\x9b\n/Users/person/.env\nfile:///private/key\nsk-abcdefghijklmnop\nAPI_KEY=abcd\n-----BEGIN PRIVATE KEY-----\nPRIVATE\n-----END PRIVATE KEY-----';
  const output = renderSubagentOutput([{ source: 'MODEL', type: 'PLANNER_RESPONSE', content }]);
  assert.match(output, /hello/);
  assert.doesNotMatch(output, /c2VjcmV0|person|private\/key|abcdefghijklmnop|abcd|PRIVATE/);
  assert.ok(
    ![...output].some((char: string) => char.charCodeAt(0) < 32 && char !== '\n' && char !== '\t'),
  );
  assert.equal(
    renderSubagentOutput([
      { source: 'MODEL', type: 'PLANNER_RESPONSE', content: 'x'.repeat(20_000) },
    ]).length,
    16_000,
  );
});

test('quoted credential fields, prefixed environment keys and authorization values are redacted', () => {
  const output = renderSubagentOutput([
    {
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      content:
        '{"access_token":"DEMO_TOKEN_NOT_SECRET","password":"DEMO_PASSWORD_NOT_SECRET"}\nPADO_ADMIN_PASSWORD=DEMO_PASSWORD_NOT_SECRET\nBearer DEMO_BEARER_NOT_SECRET\n{"apiKey": "DEMO_KEY_NOT_SECRET"}\nCookie: session=DEMO_COOKIE_NOT_SECRET',
    },
  ]);
  assert.doesNotMatch(output, /DEMO_/);
});

async function fixture() {
  const root = await realpath(await mkdtemp(resolve(tmpdir(), 'pado-output-')));
  const bridge = resolve(root, 'bridge'),
    brain = resolve(root, 'brain');
  const parentId = randomUUID(),
    childId = randomUUID(),
    turnToken = randomUUID();
  const meta = resolve(brain, parentId, '.system_generated/subagents');
  const logs = resolve(brain, childId, '.system_generated/logs');
  await Promise.all([
    mkdir(bridge),
    mkdir(meta, { recursive: true }),
    mkdir(logs, { recursive: true }),
  ]);
  const metadata = { conversationId: childId, spawnStepIndex: 5, state: 'SUBAGENT_STATE_ALIVE' };
  await writeFile(resolve(meta, `${childId}.json`), JSON.stringify(metadata));
  await writeFile(resolve(bridge, 'stage.json'), JSON.stringify({ turnToken }));
  await writeFile(
    resolve(bridge, 'subagent-view.json'),
    JSON.stringify({ conversationId: parentId, turnToken }),
  );
  await writeFile(
    resolve(bridge, `lifecycle-${parentId}.json`),
    JSON.stringify({ turnToken, initialNumSteps: 4 }),
  );
  const row = {
    step_index: 1,
    source: 'MODEL',
    type: 'PLANNER_RESPONSE',
    content: 'REAL_CHILD_OUTPUT',
    thinking: 'PRIVATE_THOUGHT',
  };
  const transcript = resolve(logs, 'transcript.jsonl');
  await writeFile(transcript, JSON.stringify(row) + '\n');
  const observer = new SubagentOutputObserver(bridge, brain);
  const events = async () => {
    try {
      return JSON.parse(await readFile(resolve(bridge, 'subagent-output.json'), 'utf8'));
    } catch {
      return [];
    }
  };
  return {
    bridge,
    brain,
    parentId,
    childId,
    turnToken,
    metadata,
    meta,
    logs,
    transcript,
    row,
    observer,
    events,
  };
}

test('container observation follows validated child metadata, fences turns and deduplicates output', async () => {
  const f = await fixture();
  f.observer.poll();
  f.observer.poll();
  const events = await f.events();
  assert.equal(events.length, 1);
  assert.equal(events[0].output, '◆ RESPONSE\nREAL_CHILD_OUTPUT');
  assert.equal(
    events[0].id,
    `native-${createHash('sha256')
      .update(f.turnToken + f.childId)
      .digest('hex')
      .slice(0, 40)}`,
  );
  assert.doesNotMatch(JSON.stringify(events), /PRIVATE|transcriptPath|thinking/);
  await writeFile(f.transcript, JSON.stringify({ ...f.row, content: 'UPDATED' }) + '\n');
  f.observer.poll();
  assert.equal((await f.events()).at(-1).output, '◆ RESPONSE\nUPDATED');
  await writeFile(resolve(f.bridge, 'stage.json'), JSON.stringify({ turnToken: randomUUID() }));
  await writeFile(f.transcript, JSON.stringify({ ...f.row, content: 'STALE' }) + '\n');
  f.observer.poll();
  assert.equal((await f.events()).length, 1);
});

test('a reused child publishes only its current invocation even when it was spawned in an older turn', async () => {
  const f = await fixture();
  // Mirrors the blank pane on 4183: parent starts at step 305, but the
  // same child was originally spawned at 172 and now resumes at step 100.
  await writeFile(
    resolve(f.bridge, `lifecycle-${f.parentId}.json`),
    JSON.stringify({ turnToken: f.turnToken, initialNumSteps: 305 }),
  );
  await writeFile(
    resolve(f.meta, `${f.childId}.json`),
    JSON.stringify({ ...f.metadata, spawnStepIndex: 172 }),
  );
  await writeFile(
    resolve(f.bridge, `lifecycle-${f.childId}.json`),
    JSON.stringify({ turnToken: f.turnToken, initialNumSteps: 100 }),
  );
  await writeFile(
    f.transcript,
    [
      { ...f.row, step_index: 99, content: 'OLD_TURN_MUST_NOT_APPEAR' },
      {
        ...f.row,
        step_index: 100,
        source: 'USER_EXPLICIT',
        type: 'USER_INPUT',
        content: 'PRIVATE_FOLLOWUP',
      },
      { ...f.row, step_index: 101, content: 'RESUMED_CHILD_OUTPUT' },
    ]
      .map((row) => JSON.stringify(row))
      .join('\n') + '\n',
  );
  f.observer.poll();
  const events = await f.events();
  assert.equal(events.length, 1);
  assert.equal(events[0].output, '◆ RESPONSE\nRESUMED_CHILD_OUTPUT');
  assert.doesNotMatch(events[0].output, /OLD_TURN|PRIVATE/);
});

test('an old child needs a valid same-turn invocation and rejects another turn or malformed hook', async () => {
  const f = await fixture();
  await writeFile(
    resolve(f.meta, `${f.childId}.json`),
    JSON.stringify({ ...f.metadata, spawnStepIndex: 3 }),
  );
  const hook = resolve(f.bridge, `lifecycle-${f.childId}.json`);
  for (const context of [
    { turnToken: randomUUID(), initialNumSteps: 0 },
    { turnToken: f.turnToken, initialNumSteps: -1 },
    { turnToken: f.turnToken, initialNumSteps: '0' },
    { turnToken: f.turnToken },
  ]) {
    await writeFile(hook, JSON.stringify(context));
    f.observer.poll();
    assert.equal((await f.events()).length, 0);
  }
  const unrelated = randomUUID();
  await writeFile(
    resolve(f.bridge, `lifecycle-${unrelated}.json`),
    JSON.stringify({ turnToken: f.turnToken, initialNumSteps: 0 }),
  );
  f.observer.poll();
  assert.equal((await f.events()).length, 0);
});

test('old metadata and symlink transcripts cannot leak into worker output', async () => {
  const f = await fixture();
  await writeFile(
    resolve(f.meta, `${f.childId}.json`),
    JSON.stringify({ ...f.metadata, spawnStepIndex: 3 }),
  );
  f.observer.poll();
  assert.equal((await f.events()).length, 0);
  const child = randomUUID();
  const logs = resolve(f.brain, child, '.system_generated/logs');
  await mkdir(logs, { recursive: true });
  await symlink(f.transcript, resolve(logs, 'transcript.jsonl'));
  await writeFile(
    resolve(f.meta, `${child}.json`),
    JSON.stringify({ ...f.metadata, conversationId: child }),
  );
  f.observer.poll();
  assert.equal((await f.events()).length, 0);
});

test('latest output storage stays bounded across updates and readers reject unsafe files', async () => {
  const f = await fixture();
  const reader = new SubagentOutputSnapshot(resolve(f.bridge, 'subagent-output.json'));
  assert.deepEqual(await reader.read(), []);
  for (let index = 0; index < 100; index++) {
    await writeFile(
      f.transcript,
      JSON.stringify({ ...f.row, content: `${index}:` + 'x'.repeat(15_900) }) + '\n',
    );
    f.observer.poll();
  }
  assert.equal((await f.events()).length, 1);
  assert.ok((await readFile(resolve(f.bridge, 'subagent-output.json'))).length < 17_000);
  assert.equal((await reader.read()).length, 1);
  assert.deepEqual(await reader.read(), []);
  await writeFile(resolve(f.bridge, 'subagent-output.json'), '{invalid');
  assert.deepEqual(await reader.read(), []);
  const link = resolve(f.bridge, 'unsafe.json');
  await symlink(f.transcript, link);
  assert.deepEqual(await new SubagentOutputSnapshot(link).read(), []);
});

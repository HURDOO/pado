import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readSync,
  readdirSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { stripVTControlCharacters } from 'node:util';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const tools = new Set([
  'view_file',
  'list_dir',
  'find_by_name',
  'grep_search',
  'run_command',
  'command_status',
  'write_to_file',
  'replace_file_content',
  'multi_replace_file_content',
  'search_web',
  'read_url_content',
  'browser_subagent',
  'invoke_subagent',
  'manage_subagents',
  'send_message',
]);

// All paths are constructed here, not taken from CLI/tool transcript fields.
function read(file, root, limit, tail = false) {
  let fd;
  try {
    if (!file.startsWith(root + '/') || realpathSync(file) !== file) return '';
    fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (!stat.isFile() || (!tail && stat.size > limit)) return '';
    const offset = Math.max(0, stat.size - limit);
    const buffer = Buffer.alloc(Math.min(stat.size, limit));
    const text = buffer
      .subarray(0, readSync(fd, buffer, 0, buffer.length, offset))
      .toString('utf8');
    return offset ? text.slice(text.indexOf('\n') + 1) : text;
  } catch {
    return '';
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
function json(file, root) {
  try {
    return JSON.parse(read(file, root, 100_000)) ?? {};
  } catch {
    return {};
  }
}
function safeText(text) {
  return stripVTControlCharacters(text)
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(
      /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/g,
      '[redacted]',
    )
    .replace(/\b(?:sk-|ghp_|github_pat_|ya29\.|AIza)[A-Za-z0-9_.-]{12,}/g, '[redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(
      /["']?\b[\w-]*(?:authorization|cookie|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|secret)[\w-]*["']?\s*[:=]\s*[^\n]+/gi,
      '[redacted]',
    )
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+\/-]+=*/gi, '[redacted]')
    .replace(/(--?(?:token|password|secret|api-key)\s+)[^\s]+/gi, '$1[redacted]')
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[redacted]@')
    .replace(/file:\/\/\/workspace\//g, '')
    .replace(
      /(?:file:\/\/|\/(?:Users|private|home|root|etc|proc|sys|var|opt|run|tmp|auth|bridge)\/)[^\s"'<>)]*/g,
      '[private path]',
    )
    .replace(/\b[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\b/gi, '[internal id]')
    .trim();
}

const labels = {
  view_file: 'READ',
  list_dir: 'LIST',
  find_by_name: 'FIND',
  grep_search: 'SEARCH',
  run_command: 'RUN',
  command_status: 'RUN',
  write_to_file: 'WRITE',
  replace_file_content: 'EDIT',
  multi_replace_file_content: 'EDIT',
  search_web: 'WEB',
  read_url_content: 'WEB',
  browser_subagent: 'BROWSER',
  invoke_subagent: 'DELEGATE',
  manage_subagents: 'AGENTS',
  send_message: 'MESSAGE',
};

function compact(value, limit = 180) {
  return typeof value === 'string' ? safeText(value).replace(/\s+/g, ' ').slice(0, limit) : '';
}

function workspacePath(value) {
  if (typeof value !== 'string' || !value || /[\x00-\x1f\\]/.test(value)) return '';
  const path = value.replace(/^(?:file:\/\/)?\/workspace(?:\/|$)/, '');
  if (
    path.startsWith('/') ||
    /(^|\/)(?:\.\.|\.env(?:\..*)?|\.gemini|\.ssh|\.git)(\/|$)/i.test(path)
  )
    return '';
  return compact(path || '.', 180);
}

function excerpt(value, maxLines = 14, maxChars = 1600) {
  const text = safeText(value);
  const lines = text.split('\n');
  const selected = lines.slice(0, maxLines).join('\n').slice(0, maxChars);
  return selected + (selected.length < text.length ? '\n… 일부 생략' : '');
}

function argument(value) {
  if (typeof value !== 'string') return value;
  // Native transcript arguments are individually JSON-encoded; older fixtures
  // and CLI versions may already contain plain scalar values.
  try {
    const decoded = JSON.parse(value);
    if (typeof decoded === 'string' || typeof decoded === 'number') return decoded;
  } catch {
    // The CLI can truncate a JSON string mid-value. Show only its intact prefix,
    // decode literal escapes before redaction, and make the omission explicit.
    const marker = value.indexOf('<truncated ');
    if (value.startsWith('"') && marker >= 0)
      return (
        value.slice(1, marker).replace(/\\(?:["\\/bfnrt]|u[0-9a-f]{4})/gi, (escape) => {
          try {
            return JSON.parse(`"${escape}"`);
          } catch {
            return '';
          }
        }) + '\n… 기록 일부 생략'
      );
  }
  return value;
}

function toolBlock(tool) {
  const name = tools.has(tool?.name) ? tool.name : '';
  // Unknown tools never expose their arguments (which may contain system prompts).
  const args =
    name && tool.args && typeof tool.args === 'object'
      ? Object.fromEntries(
          Object.entries(tool.args)
            .slice(0, 64)
            .map(([key, value]) => [key, argument(value)]),
        )
      : {};
  const path = workspacePath(
    args.AbsolutePath ?? args.TargetFile ?? args.DirectoryPath ?? args.SearchDirectory,
  );
  const range =
    path && Number.isSafeInteger(args.StartLine) && args.StartLine > 0
      ? `:${args.StartLine}${Number.isSafeInteger(args.EndLine) && args.EndLine >= args.StartLine ? `–${args.EndLine}` : ''}`
      : '';
  const target = name === 'run_command' ? compact(args.CommandLine) : path + range;
  const summary = compact(args.toolSummary || args.Description);
  return {
    name,
    args,
    path,
    lines: [
      `┌─ ${labels[name] ?? 'TOOL'}${target ? `  ${target}` : ''}`,
      ...(summary ? [`│ ${summary}`] : []),
      ...(name === 'send_message' && typeof args.Message === 'string'
        ? excerpt(args.Message)
            .split('\n')
            .map((line) => `│ ${line}`)
        : []),
    ],
    result: null,
  };
}

function resultLines(block) {
  const row = block.result;
  if (!row) return ['└─ · 결과 대기'];
  // Consume only known payload sections; never forward CLI wrappers, injected
  // instructions, tool error objects, stack traces, or internal identifiers.
  const text = typeof row.content === 'string' ? row.content : '';
  const body = text.replace(/^(?:(?:Created|Completed) At:[^\n]*\n|\s*\n)*/, '');
  if (row.status === 'ERROR' || /^(?:Encountered error|Error:|Permission denied)/i.test(body)) {
    const reason = /permission|denied|deny rule/i.test(body)
      ? '권한 거부 또는 승인 미완료'
      : '도구 실행 오류';
    return [`└─ ! ${reason}`];
  }
  if (row.status === 'RUNNING') return ['└─ · 실행 중'];
  if (row.status !== 'DONE') return ['└─ · 결과 확인 중'];
  if (block.name === 'run_command' || block.name === 'command_status') {
    const match = body.match(/^The command exited with code (-?\d+)\.\s*Output:\s*\n([\s\S]*)$/);
    if (!match) return ['└─ · 명령 응답 수신 · 종료 코드 미확인'];
    let code = Number(match[1]);
    let output = match[2];
    try {
      // The credential-free workspace helper wraps stdout and the inner exit code.
      const wrapped = JSON.parse(output);
      if (typeof wrapped.output === 'string' && Number.isSafeInteger(wrapped.code)) {
        if (code === 0) code = wrapped.code;
        output = wrapped.output;
      }
    } catch {
      /* Ordinary stdout is not JSON. */
    }
    // Do not replay runtime diagnostics/stack dumps; retain the factual exit code.
    const diagnostic = /(?:\n|^)(?:\s+at |(?:[\w.]+)?Error:|Traceback \(|Encountered error)/m.test(
      output,
    );
    const sensitiveCommand =
      /\b(?:printenv|env|credentials|\.env|\.ssh)\b|\/(?:auth|bridge|home|etc|proc)\//i.test(
        String(block.args.CommandLine ?? ''),
      );
    const detail = diagnostic || sensitiveCommand ? '상세 출력 비공개' : excerpt(output);
    return [
      ...detail
        .split('\n')
        .filter(Boolean)
        .map((line) => `│ ${line}`),
      `└─ ${code === 0 ? '✓' : '!'} 종료 코드 ${code}`,
    ];
  }
  if (block.name === 'replace_file_content' || block.name === 'multi_replace_file_content') {
    const diff =
      block.path && body.match(/\[diff_block_start\]\n([\s\S]*?)(?:\[diff_block_end\]|$)/)?.[1];
    return [
      ...(diff
        ? excerpt(
            diff
              .split('\n')
              .filter((line) => /^(?:@@|[ +\-])/.test(line))
              .join('\n'),
            24,
            2200,
          )
            .split('\n')
            .map((line) => `│ ${line}`)
        : []),
      `└─ ✓ 수정 도구 완료${diff ? ' · diff 발췌' : ''}`,
    ];
  }
  const complete = {
    view_file: '파일 읽기 완료',
    list_dir: '목록 조회 완료',
    find_by_name: '검색 완료',
    grep_search: '검색 완료',
    write_to_file: '파일 쓰기 완료',
    send_message: '메시지 전달 완료',
    invoke_subagent: '위임 등록 완료 · 하위 작업은 별도 진행',
  };
  const count = /^(?:Found (\d+) results|Empty directory)\s*$/.exec(body.trim());
  return [
    `└─ ✓ ${complete[block.name] ?? '도구 응답 수신'}${count ? ` · ${count[1] ?? 0}개` : ''}`,
  ];
}

/** Public responses plus selected, redacted task details; never thoughts or prompts. */
export function renderSubagentOutput(rows) {
  const blocks = [];
  let pending = null;
  for (const row of rows) {
    if (row?.source !== 'MODEL') continue;
    if (row.type === 'GENERIC') {
      if (pending) pending.result = row;
      pending = null;
      continue;
    }
    if (row.type !== 'PLANNER_RESPONSE') continue;
    pending = null;
    if (row.status === 'ERROR') continue;
    if (typeof row.content === 'string') {
      const content = safeText(row.content);
      if (content) blocks.push({ lines: ['◆ RESPONSE', content] });
    }
    if (Array.isArray(row.tool_calls)) {
      const calls = row.tool_calls.slice(0, 32).map(toolBlock);
      blocks.push(...calls);
      // The native transcript has no reliable call ID on GENERIC rows. Only
      // associate an immediately following result with one unambiguous call.
      if (row.tool_calls.length === 1) pending = calls[0];
    }
  }
  const output = blocks
    .map((block) => [...block.lines, ...('name' in block ? resultLines(block) : [])].join('\n'))
    .join('\n\n');
  const marker = '… 이전 로그 생략\n\n';
  return output.length > 16_000 ? marker + output.slice(-(16_000 - marker.length)) : output;
}

// Runs beside the native CLI inside its container. It never launches a second
// agent or sends input to a child just to display its trajectory.
export class SubagentOutputObserver {
  constructor(bridge = '/bridge', brain = '/home/node/.gemini/antigravity-cli/brain') {
    this.bridge = resolve(bridge);
    this.brain = resolve(brain);
    this.previous = new Map();
    this.outputs = new Map();
    this.token = undefined;
  }
  poll() {
    try {
      const context = json(resolve(this.bridge, 'subagent-view.json'), this.bridge);
      const stage = json(resolve(this.bridge, 'stage.json'), this.bridge);
      if (
        !uuid.test(context.conversationId ?? '') ||
        !uuid.test(context.turnToken ?? '') ||
        context.turnToken !== stage.turnToken
      )
        return;
      if (context.turnToken !== this.token) {
        this.token = context.turnToken;
        this.previous.clear();
        this.outputs.clear();
      }
      const lifecycle = json(
        resolve(this.bridge, `lifecycle-${context.conversationId}.json`),
        this.bridge,
      );
      if (lifecycle.turnToken !== this.token || !Number.isSafeInteger(lifecycle.initialNumSteps))
        return;
      const metadata = resolve(this.brain, context.conversationId, '.system_generated/subagents');
      if (realpathSync(metadata) !== metadata) return;
      let count = 0;
      let changed = false;
      for (const file of readdirSync(metadata).slice(0, 512)) {
        const child = file.replace(/\.json$/, '');
        if (!uuid.test(child) || file !== `${child}.json`) continue;
        const meta = json(resolve(metadata, file), this.brain);
        const invocation = json(resolve(this.bridge, `lifecycle-${child}.json`), this.bridge);
        const currentInvocation =
          invocation.turnToken === this.token &&
          Number.isSafeInteger(invocation.initialNumSteps) &&
          invocation.initialNumSteps >= 0;
        if (
          meta.conversationId !== child ||
          !Number.isSafeInteger(meta.spawnStepIndex) ||
          meta.spawnStepIndex < 0 ||
          (meta.spawnStepIndex < lifecycle.initialNumSteps && !currentInvocation) ||
          meta.state !== 'SUBAGENT_STATE_ALIVE'
        )
          continue;
        if (++count > 64) break;
        const text = read(
          resolve(this.brain, child, '.system_generated/logs/transcript.jsonl'),
          this.brain,
          1_000_000,
          true,
        );
        const rows = text
          .split('\n')
          .slice(-4000)
          .flatMap((line) => {
            try {
              const row = JSON.parse(line);
              // An existing native child can be resumed with send_message in a
              // later user turn. Its original spawn step does not change. Use
              // its validated same-turn hook as the fence and omit old output.
              const firstStep = currentInvocation ? invocation.initialNumSteps : 0;
              return Number.isSafeInteger(row?.step_index) && row.step_index >= firstStep
                ? [row]
                : [];
            } catch {
              return [];
            }
          });
        const output = renderSubagentOutput(rows);
        if (!output || this.previous.get(child) === output) continue;
        if (!this.outputs.has(child) && this.outputs.size >= 64) continue;
        const event = {
          turnToken: this.token,
          conversationId: context.conversationId,
          at: Date.now(),
          id: `native-${createHash('sha256')
            .update(this.token + child)
            .digest('hex')
            .slice(0, 40)}`,
          output,
        };
        this.outputs.set(child, event);
        this.previous.set(child, output);
        changed = true;
      }
      if (changed) {
        // Replace a bounded latest snapshot instead of accumulating full copies
        // forever. Atomic replacement also prevents partially read JSON.
        const temporary = resolve(this.bridge, `.subagent-output-${randomUUID()}.tmp`);
        writeFileSync(temporary, JSON.stringify([...this.outputs.values()]), {
          flag: 'wx',
          mode: 0o600,
        });
        renameSync(temporary, resolve(this.bridge, 'subagent-output.json'));
      }
    } catch {
      /* Observation must never affect agent execution. */
    }
  }
}

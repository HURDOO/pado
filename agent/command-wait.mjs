import {
  constants,
  openSync,
  closeSync,
  fstatSync,
  readSync,
  realpathSync,
  writeFileSync,
  renameSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { helperArguments } from './public-policy.mjs';

const id = /^[a-zA-Z0-9_-]{1,100}$/;
const token = /^[a-f0-9-]{36}$/i;
const brain = '/home/node/.gemini/antigravity-cli/brain';
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
    return JSON.parse(read(file, root, 100000)) ?? {};
  } catch {
    return {};
  }
}
function atomic(bridge, file, value) {
  const temporary = resolve(bridge, `.command-wait-${randomUUID()}.tmp`);
  writeFileSync(temporary, JSON.stringify(value), { flag: 'wx', mode: 0o600 });
  renameSync(temporary, resolve(bridge, file));
}
function context(bridge, root) {
  const view = json(resolve(bridge, 'subagent-view.json'), bridge);
  const stage = json(resolve(bridge, 'stage.json'), bridge);
  if (
    !id.test(view.conversationId ?? '') ||
    !token.test(view.turnToken ?? '') ||
    stage.turnToken !== view.turnToken
  )
    return;
  const lifecycle = json(resolve(bridge, `lifecycle-${view.conversationId}.json`), bridge);
  if (lifecycle.turnToken !== view.turnToken || !Number.isSafeInteger(lifecycle.initialNumSteps))
    return;
  const rows = read(
    resolve(root, view.conversationId, '.system_generated/logs/transcript.jsonl'),
    root,
    1000000,
    true,
  )
    .split('\n')
    .slice(-4000)
    .flatMap((line) => {
      try {
        const row = JSON.parse(line);
        return Number.isSafeInteger(row.step_index) && row.step_index >= lifecycle.initialNumSteps
          ? [row]
          : [];
      } catch {
        return [];
      }
    });
  return { view, rows };
}
function words(row) {
  if (row?.type !== 'PLANNER_RESPONSE' || row.source !== 'MODEL' || row.tool_calls?.length !== 1)
    return;
  const call = row.tool_calls[0];
  if (call.name !== 'run_command' || typeof call.args?.CommandLine !== 'string') return;
  let command = call.args.CommandLine;
  try {
    command = JSON.parse(command);
  } catch {
    /* Some CLI versions use plain values. */
  }
  const args = helperArguments(command);
  return args && ['exec', 'run'].includes(args[2]) ? args : undefined;
}

// Called by the immutable helper, not supplied as command-line metadata. Exact argv
// matching prevents a late/reused ID, a child, or a different tool from claiming a run.
export function bindCommandWait(argv, bridge = '/bridge', root = brain) {
  try {
    const state = context(resolve(bridge), resolve(root));
    if (!state) return;
    const row = state.rows.findLast(
      (row) => row.type === 'PLANNER_RESPONSE' && row.source === 'MODEL',
    );
    const args = words(row);
    if (!args || JSON.stringify(args.slice(2)) !== JSON.stringify(argv)) return;
    if (state.rows.some((next) => next.step_index > row.step_index && next.type === 'GENERIC'))
      return;
    // Confirm actual entry into the still-pending native tool. PostInvocation
    // timing varies across CLI versions; return/resume hooks clear this phase.
    atomic(resolve(bridge), `command-phase-${state.view.conversationId}.json`, {
      turnToken: state.view.turnToken,
      phase: 'tools',
    });
    return {
      conversationId: state.view.conversationId,
      turnToken: state.view.turnToken,
      step: row.step_index,
    };
  } catch {
    /* Missing/ambiguous native evidence stays private. */
  }
}

// This observes invocation phase only; it never grants a tool permission or copies
// prompts, argv, transcript content or native logs into the public bridge snapshot.
export function recordCommandPhase(event, value, bridge = '/bridge') {
  try {
    if (
      !['start', 'progress', 'stop', 'command-return'].includes(event) ||
      !id.test(value.conversationId ?? '')
    )
      return;
    if (event === 'command-return' && value.toolCall?.name !== 'run_command') return;
    bridge = resolve(bridge);
    const lifecycle = json(resolve(bridge, `lifecycle-${value.conversationId}.json`), bridge);
    if (
      !token.test(lifecycle.turnToken ?? '') ||
      json(resolve(bridge, 'stage.json'), bridge).turnToken !== lifecycle.turnToken
    )
      return;
    atomic(bridge, `command-phase-${value.conversationId}.json`, {
      turnToken: lifecycle.turnToken,
      phase:
        event === 'start'
          ? 'thinking'
          : event === 'progress'
            ? 'tools'
            : event === 'command-return'
              ? 'between-tools'
              : !value.fullyIdle && !value.error && value.terminationReason !== 'error'
                ? 'waiting'
                : 'idle',
    });
  } catch {
    /* Observation must never interrupt the CLI. */
  }
}

export function waitingSteps(rows, phase) {
  if (phase !== 'tools' && phase !== 'waiting') return [];
  const lastModel = rows.findLast(
    (row) => row.type === 'PLANNER_RESPONSE' && row.source === 'MODEL',
  );
  if (phase === 'tools') {
    // Native transcripts may say RUNNING before the blocking tool returns. The
    // PostToolUse hook moves phase to between-tools on actual background return.
    return words(lastModel) &&
      !rows.some(
        (row) =>
          row.step_index > lastModel.step_index &&
          row.type === 'GENERIC' &&
          ['DONE', 'ERROR'].includes(row.status),
      )
      ? [lastModel.step_index]
      : [];
  }
  // Stop(fullyIdle:false) is an actual paused invocation. Only its known helper
  // background calls qualify, and the host additionally requires an unfinished run.
  return rows
    .flatMap((row, index) =>
      words(row) && rows[index + 1]?.type === 'GENERIC' && rows[index + 1]?.status === 'RUNNING'
        ? [row.step_index]
        : [],
    )
    .slice(-64);
}

export class CommandWaitObserver {
  constructor(bridge = '/bridge', root = brain) {
    this.bridge = resolve(bridge);
    this.root = resolve(root);
  }
  poll() {
    try {
      const state = context(this.bridge, this.root);
      if (!state) return;
      const phase = json(
        resolve(this.bridge, `command-phase-${state.view.conversationId}.json`),
        this.bridge,
      );
      const steps =
        phase.turnToken === state.view.turnToken ? waitingSteps(state.rows, phase.phase) : [];
      // A bounded heartbeat lets the host fail closed if the observer disappears.
      atomic(this.bridge, 'command-wait.json', [
        {
          conversationId: state.view.conversationId,
          turnToken: state.view.turnToken,
          at: Date.now(),
          steps,
        },
      ]);
    } catch {
      /* Keep the native process independent of observation. */
    }
  }
}

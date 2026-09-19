import {
  appendFileSync,
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

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const states = new Set(['working', 'idle', 'ended', 'error']);
const maxTail = 1_000_000;
const object = (value) =>
  value && typeof value === 'object' && !Array.isArray(value) ? value : {};

function within(file, root) {
  return file.startsWith(root + '/') && realpathSync(file) === file;
}
function bounded(file, root, limit, tail = false) {
  let descriptor;
  try {
    if (!within(file, root)) return;
    descriptor = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.size > (tail ? 16_000_000 : limit)) return;
    const offset = Math.max(0, stat.size - limit);
    const buffer = Buffer.alloc(Math.min(limit, stat.size));
    const bytes = readSync(descriptor, buffer, 0, buffer.length, offset);
    const text = buffer.subarray(0, bytes).toString('utf8');
    return offset ? text.slice(text.indexOf('\n') + 1) : text;
  } catch {
    return;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}
function json(file, root, limit = 16_000) {
  try {
    return object(JSON.parse(bounded(file, root, limit)));
  } catch {
    return {};
  }
}
function transcript(file, root) {
  const text = bounded(file, root, maxTail, true);
  if (!text) return [];
  return text
    .split('\n')
    .slice(-4000)
    .flatMap((line) => {
      try {
        const row = object(JSON.parse(line));
        return Number.isSafeInteger(row.step_index) && row.step_index >= 0 ? [row] : [];
      } catch {
        return [];
      }
    });
}
function validAgent(agent) {
  return (
    typeof agent?.id === 'string' &&
    /^native-[a-f0-9]{40}$/i.test(agent.id) &&
    typeof agent.name === 'string' &&
    /^Subagent [1-9][0-9]?$/.test(agent.name) &&
    states.has(agent.state)
  );
}

/** Container-only metadata extraction. Never follow transcript paths supplied by tool output. */
export function observeSubagents(
  event,
  value,
  bridge = '/bridge',
  brainRoot = '/home/node/.gemini/antigravity-cli/brain',
) {
  if (!uuid.test(value.conversationId ?? '')) return;
  const root = resolve(brainRoot);
  const parent = resolve(root, value.conversationId, '.system_generated');
  const parentTranscript = resolve(parent, 'logs/transcript.jsonl');
  try {
    if (!within(parentTranscript, root)) return;
    const context = json(
      resolve(bridge, `lifecycle-${value.conversationId}.json`),
      resolve(bridge),
    );
    if (!uuid.test(context.turnToken ?? '') || !Number.isSafeInteger(context.initialNumSteps))
      return;
    const stage = json(resolve(bridge, 'stage.json'), resolve(bridge), 100_000);
    if (stage.turnToken !== context.turnToken) return;
    const savedFile = resolve(parent, 'pado-subagents.json');
    const saved = json(savedFile, root, 100_000);
    const previous = saved.turnToken === context.turnToken ? object(saved.agents) : {};
    const agents = Object.fromEntries(
      Object.entries(previous)
        .filter(([id, agent]) => uuid.test(id) && validAgent(agent))
        .slice(0, 64),
    );
    const metadata = resolve(parent, 'subagents');
    let files = [];
    try {
      if (within(metadata, root)) files = readdirSync(metadata).slice(0, 512);
    } catch {
      /* No delegation yet. */
    }
    const publishedStates = new Map(Object.values(agents).map((agent) => [agent.id, agent.state]));
    const update = (agent, state) => {
      agent.state = state;
    };
    for (const file of files) {
      const conversationId = file.replace(/\.json$/, '');
      if (!uuid.test(conversationId) || file !== `${conversationId}.json`) continue;
      const meta = json(resolve(metadata, file), root);
      if (
        meta.conversationId !== conversationId ||
        !Number.isSafeInteger(meta.spawnStepIndex) ||
        meta.spawnStepIndex < context.initialNumSteps ||
        meta.state !== 'SUBAGENT_STATE_ALIVE'
      )
        continue;
      if (!agents[conversationId]) {
        if (Object.keys(agents).length >= 64) continue;
        agents[conversationId] = {
          id: `native-${createHash('sha256')
            .update(context.turnToken + conversationId)
            .digest('hex')
            .slice(0, 40)}`,
          name: `Subagent ${Object.keys(agents).length + 1}`,
          state: 'working',
        };
        update(agents[conversationId], 'working');
      }
    }
    const rows = transcript(parentTranscript, root).filter(
      (row) => row.step_index >= context.initialNumSteps,
    );
    const tool = event === 'tool' && !value.error ? object(value.toolCall) : {};
    const args = object(tool.args);
    for (const [conversationId, agent] of Object.entries(agents)) {
      const childRows = transcript(
        resolve(root, conversationId, '.system_generated/logs/transcript.jsonl'),
        root,
      );
      const last = childRows.at(-1);
      if (
        tool.name === 'send_message' &&
        args.Recipient === conversationId &&
        Number.isSafeInteger(value.stepIdx) &&
        value.stepIdx > (agent.lastResumeStep ?? -1)
      ) {
        agent.lastResumeStep = value.stepIdx;
        agent.resumeAfter = last?.step_index ?? -1;
        agent.terminated = false;
        update(agent, 'working');
      }
      if (
        tool.name === 'manage_subagents' &&
        (args.Action === 'kill_all' ||
          (args.Action === 'kill' &&
            Array.isArray(args.ConversationIds) &&
            args.ConversationIds.includes(conversationId)))
      ) {
        agent.terminated = true;
        update(agent, 'ended');
      }
      if (agent.terminated || !last || last.step_index <= (agent.resumeAfter ?? -1)) continue;
      // A message from a child is never completion evidence. Its own final model
      // response is idle, while tool calls and tool errors can still lead to work.
      if (
        last.source === 'MODEL' &&
        last.type === 'PLANNER_RESPONSE' &&
        (!Array.isArray(last.tool_calls) || last.tool_calls.length === 0)
      ) {
        if (last.status === 'DONE' && typeof last.content === 'string' && last.content.trim())
          update(agent, 'idle');
        else if (last.status === 'ERROR') update(agent, 'error');
      } else if (Number.isSafeInteger(agent.lastStep) && last.step_index > agent.lastStep)
        update(agent, 'working');
      agent.lastStep = last.step_index;
    }
    // Native list results can confirm idle/running/error even when the model is
    // waiting on background tasks. Read only the result paired with that tool.
    for (let index = 1; index < rows.length; index++) {
      const row = rows[index],
        before = rows[index - 1];
      if (
        row.type !== 'GENERIC' ||
        row.status !== 'DONE' ||
        typeof row.content !== 'string' ||
        !before.tool_calls?.some(
          (call) => call.name === 'manage_subagents' && call.args?.Action === 'list',
        )
      )
        continue;
      try {
        const entries = JSON.parse(row.content.slice(row.content.indexOf('[')));
        if (!Array.isArray(entries)) continue;
        for (const entry of entries.slice(0, 64)) {
          const agent = agents[entry?.conversationId];
          if (!agent || agent.terminated || row.step_index <= (agent.lastResumeStep ?? -1))
            continue;
          // A final child response newer than this list remains the better signal.
          const listAt = Date.parse(row.created_at ?? '');
          const childRows = transcript(
            resolve(root, entry.conversationId, '.system_generated/logs/transcript.jsonl'),
            root,
          );
          const childAt = Date.parse(childRows.at(-1)?.created_at ?? '');
          if (!Number.isFinite(listAt) || (Number.isFinite(childAt) && listAt < childAt)) continue;
          if (entry.state === 'idle') update(agent, 'idle');
          else if (entry.state === 'running') update(agent, 'working');
          else if (entry.state === 'error') update(agent, 'error');
        }
      } catch {
        /* Unknown result formats never become public state. */
      }
    }
    const temporary = resolve(parent, `.pado-subagents-${randomUUID()}.tmp`);
    writeFileSync(temporary, JSON.stringify({ turnToken: context.turnToken, agents }), {
      flag: 'wx',
      mode: 0o600,
    });
    renameSync(temporary, savedFile);
    for (const [childConversationId, { id, name, state }] of Object.entries(agents)) {
      if (publishedStates.get(id) === state) continue;
      appendFileSync(
        resolve(bridge, 'subagents.ndjson'),
        JSON.stringify({
          turnToken: context.turnToken,
          conversationId: value.conversationId,
          childConversationId,
          at: Date.now(),
          agent: { id, name, state },
        }) + '\n',
        { mode: 0o600 },
      );
    }
  } catch {
    /* Metadata observation must never affect native agent execution. */
  }
}

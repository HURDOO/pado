import type { AgentActivity } from '../shared/protocol.ts';

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as RecordValue) : undefined;
const phases: Record<string, AgentActivity['phase']> = {
  view_file: 'reading',
  list_dir: 'reading',
  grep_search: 'reading',
  find_by_name: 'reading',
  write_to_file: 'writing',
  replace_file_content: 'writing',
  multi_replace_file_content: 'writing',
  run_command: 'running',
  command_status: 'running',
  define_subagent: 'delegating',
  invoke_subagent: 'delegating',
  manage_subagents: 'delegating',
};

/** Derive a tiny public status surface, never raw prompts, tool output, paths or logs. */
export class AgentProgress {
  private activity: AgentActivity = { phase: 'planning', subagents: [] };
  private conversations = new Map<string, string>();
  private previous = '';
  read(value: unknown): AgentActivity | undefined {
    const step = record(value);
    if (!step) return;
    const tool = typeof step.tool_name === 'string' ? step.tool_name : '';
    if (step.state === 'ACTIVE' && phases[tool]) this.activity.phase = phases[tool];
    if (step.step_type === 'agent_response') this.activity.phase = 'reviewing';
    const info = record(step.subagent_info);
    if (
      tool === 'invoke_subagent' &&
      Number.isSafeInteger(step.step_index) &&
      Array.isArray(info?.subagents)
    ) {
      info.subagents.slice(0, 8).forEach((raw, index) => {
        const agent = record(raw);
        if (!agent) return;
        const id = `delegate-${step.step_index}-${index}`;
        const name =
          typeof agent.type_name === 'string' &&
          /^[a-zA-Z][a-zA-Z0-9_-]{0,47}$/.test(agent.type_name)
            ? agent.type_name.replaceAll('_', ' ')
            : 'Subagent';
        let item = this.activity.subagents.find((item) => item.id === id);
        if (!item && this.activity.subagents.length < 8) {
          item = { id, name, state: 'starting' };
          this.activity.subagents.push(item);
        }
        if (!item) return;
        if (step.state === 'DONE') item.state = record(step.tool_info)?.error ? 'error' : 'working';
        if (
          typeof agent.conversation_id === 'string' &&
          this.conversations.size < 32 &&
          /^[0-9a-f-]{36}$/i.test(agent.conversation_id)
        )
          this.conversations.set(agent.conversation_id, id);
      });
    }
    const toolInfo = record(step.tool_info),
      parameters = record(toolInfo?.parameters);
    if (tool === 'manage_subagents' && step.state === 'DONE' && !toolInfo?.error) {
      if (parameters?.Action === 'kill' && Array.isArray(parameters.ConversationIds)) {
        for (const id of parameters.ConversationIds) {
          const item =
            typeof id === 'string' &&
            this.activity.subagents.find((item) => item.id === this.conversations.get(id));
          if (item) item.state = 'ended';
        }
      }
      if (
        parameters?.Action === 'list' &&
        typeof toolInfo?.output === 'string' &&
        toolInfo.output.length < 32_000
      ) {
        try {
          const entries: unknown = JSON.parse(toolInfo.output.slice(toolInfo.output.indexOf('[')));
          if (Array.isArray(entries))
            for (const raw of entries.slice(0, 16)) {
              const entry = record(raw);
              const id =
                typeof entry?.conversationId === 'string'
                  ? this.conversations.get(entry.conversationId)
                  : undefined;
              const item = this.activity.subagents.find((item) => item.id === id);
              if (item && entry?.state === 'idle') item.state = 'idle';
              else if (item && entry?.state === 'running') item.state = 'working';
              else if (item && entry?.state === 'error') item.state = 'error';
            }
        } catch {
          /* Unknown CLI output is not public and cannot change child state. */
        }
      }
    }
    const next = JSON.stringify(this.activity);
    if (next === this.previous) return;
    this.previous = next;
    return JSON.parse(next) as AgentActivity;
  }
}

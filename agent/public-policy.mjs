import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Public requests may execute code only through the credential-free app runner. The
// authenticated CLI can invoke this one immutable bridge helper, never a general shell.
export function helperArguments(command) {
  if (typeof command !== 'string' || command.length > 80000) return null;
  const words = [];
  let word = '',
    quote = '',
    started = false;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote === "'") {
      if (c === "'") quote = '';
      else word += c;
      started = true;
      continue;
    }
    if (c === '\\') {
      const next = command[++i];
      if (!next || next === '\n' || (quote === '"' && !['"', '\\', '$', '`'].includes(next)))
        return null;
      word += next;
      started = true;
      continue;
    }
    if (c === '$' || c === '`' || (!quote && /[;&|<>\n\r(){}*?~]/.test(c))) return null;
    if (quote === '"') {
      if (c === '"') quote = '';
      else word += c;
      started = true;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      started = true;
      continue;
    }
    if (/\s/.test(c)) {
      if (started) {
        words.push(word);
        word = '';
        started = false;
      }
      continue;
    }
    word += c;
    started = true;
  }
  if (quote) return null;
  if (started) words.push(word);
  if (
    words[0] !== 'node' ||
    words[1] !== '/opt/pado/present.mjs' ||
    words.length < 3 ||
    words[2] === '--file'
  )
    return null;
  return words;
}

const delegationTools = new Set([
  'define_subagent',
  'invoke_subagent',
  'manage_subagents',
  'send_message',
]);

export function publicToolDecision(
  value,
  allowSubagents = process.env.PADO_PUBLIC_SUBAGENTS === '1',
) {
  const call = value?.toolCall;
  if (allowSubagents && delegationTools.has(call?.name)) return { decision: 'allow' };
  if (
    call?.name === 'run_command' &&
    call.args?.Cwd === '/workspace' &&
    helperArguments(call.args.CommandLine)
  )
    return { decision: 'allow' };
  return {
    decision: 'deny',
    reason:
      "Public Pado: use node /opt/pado/present.mjs exec ID from /workspace for commands; add --quiet node -e '...' for internal file reads/edits only. Installs/builds/tests use normal exec, or --show for requested logs. Code executes in the credential-free app container. Present panes with single-quoted inline JSON; --file, direct file tools, CLI settings and workspace hooks are unavailable in public mode. " +
      (allowSubagents
        ? 'Subagent delegation and messaging are enabled for this trusted hackathon demo; children must use the same helper for file and command work.'
        : 'Subagents are unavailable in public mode.'),
  };
}
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  try {
    const input = JSON.parse(readFileSync(0, 'utf8'));
    const decision = publicToolDecision(input);
    // Names and decisions only: never persist tool arguments, prompt text or secrets.
    appendFileSync(
      '/bridge/public-policy.ndjson',
      JSON.stringify({
        tool: String(input?.toolCall?.name || '').slice(0, 80),
        decision: decision.decision,
      }) + '\n',
      { mode: 0o600 },
    );
    console.log(JSON.stringify(decision));
  } catch {
    console.log(
      JSON.stringify({
        decision: 'deny',
        reason: 'Public tool policy could not validate the request.',
      }),
    );
  }
}

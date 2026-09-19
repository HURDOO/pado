import { copyFileSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { SubagentOutputObserver } from './subagent-output.mjs';
import { CommandWaitObserver } from './command-wait.mjs';

// A writable, session-local profile permits the CLI's atomic settings updates.
// Only the dedicated runner login is copied; never expose or mount host credentials.
const profile = '/home/node/.gemini/antigravity-cli';
mkdirSync(profile, { recursive: true, mode: 0o700 });
mkdirSync(`${profile}/cache`, { recursive: true, mode: 0o700 });
mkdirSync('/home/node/.gemini/config', { recursive: true, mode: 0o700 });
try {
  copyFileSync(
    '/auth/antigravity-cli/antigravity-oauth-token',
    `${profile}/antigravity-oauth-token`,
  );
  // Preserve the onboarding the user already completed in agent:login.
  copyFileSync('/auth/antigravity-cli/cache/onboarding.json', `${profile}/cache/onboarding.json`);
  if (process.env.PADO_PUBLIC_MODE === '1') {
    // CLI startup atomically saves settings. Public tools cannot mutate this profile;
    // enforcement lives in the separately read-only global hooks mount.
    copyFileSync('/opt/pado/public-settings.json', `${profile}/settings.json`);
  } else {
    copyFileSync('/opt/pado/tui-settings.json', `${profile}/settings.json`);
    copyFileSync('/opt/pado/tui-hooks.json', '/home/node/.gemini/config/hooks.json');
  }
} catch {
  process.stdout.write(
    'Pado: dedicated Antigravity login is unavailable. Ask the administrator to run agent:login.\r\n',
  );
  process.exit(1);
}
const conversation = process.argv[2];
if (conversation && !/^[a-zA-Z0-9_-]{1,100}$/.test(conversation)) process.exit(1);
const child = spawn(
  'agy',
  ['--mode', 'accept-edits', ...(conversation ? ['--conversation', conversation] : [])],
  { stdio: 'inherit' },
);
const output = new SubagentOutputObserver();
setInterval(() => output.poll(), 400).unref();
const waiting = new CommandWaitObserver();
setInterval(() => waiting.poll(), 200).unref();
child.on('error', () => process.exit(1));
child.on('exit', (code) => process.exit(code ?? 1));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));

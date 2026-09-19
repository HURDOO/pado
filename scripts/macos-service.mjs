import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile, lstat, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { homedir } from 'node:os';

// Explicit operator command: installs only the two Pado user LaunchAgents. Tokens
// remain in private files; no credential value is placed in plist, argv or stdout.
if (process.platform !== 'darwin') throw new Error('This deployment targets macOS');
const action = process.argv[2];
if (!['prepare', 'install', 'status'].includes(action))
  throw new Error('Use prepare, install or status');
const root = await realpath(resolve('.'));
if (root !== '/Users/hurdoo/coding/projects/pado') throw new Error('Run from the Pado project');
const directory = resolve(root, '.pado/deploy');
const labels = ['kr.hurdoo.pado.server', 'kr.hurdoo.pado.tunnel'];
const domain = `gui/${process.getuid()}`;
const xml = (value) =>
  String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
if (action === 'prepare') {
  const image = execFileSync(
    'docker',
    ['image', 'inspect', '--format', '{{.Id}}', 'pado-agent:public-candidate'],
    { encoding: 'utf8' },
  ).trim();
  if (!/^sha256:[a-f0-9]{64}$/.test(image)) throw new Error('Validated candidate image required');
  const connector = await lstat(resolve(root, '.pado/tunnel/connector.secret'));
  if (!connector.isFile() || connector.isSymbolicLink() || connector.mode & 0o077)
    throw new Error('Private connector token required');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(
    resolve(directory, 'public.env'),
    [
      'PADO_PORT=4173',
      'PADO_BIND_HOST=127.0.0.1',
      'PADO_ORIGIN=https://pado.hurdoo.kr',
      'PADO_PUBLIC_MODE=1',
      'PADO_PARTICIPANT_TUI=1',
      'PADO_PUBLIC_SUBAGENTS=1',
      'PADO_DEMO_SHORT_ADMIN_PASSWORD=1',
      'PADO_TRUST_CLOUDFLARE=1',
      'PADO_RUNNER=antigravity',
      'PADO_PREVIEW_BASE_PORT=4273',
      `PADO_AGENT_IMAGE=${image}`,
      '',
    ].join('\n'),
    { mode: 0o600 },
  );
  const commands = [
    [
      '/opt/homebrew/bin/node',
      '--env-file-if-exists=.env',
      '--env-file=.pado/deploy/public.env',
      '--import',
      'tsx',
      'server/index.ts',
      '--production',
    ],
    [
      '/opt/homebrew/bin/cloudflared',
      'tunnel',
      '--no-autoupdate',
      'run',
      '--token-file',
      resolve(root, '.pado/tunnel/connector.secret'),
    ],
  ];
  for (const [index, label] of labels.entries()) {
    const output = resolve(directory, index === 0 ? 'server.log' : 'tunnel.log');
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array>${commands[index].map((arg) => `<string>${xml(arg)}</string>`).join('')}</array>
<key>WorkingDirectory</key><string>${xml(root)}</string>
<key>EnvironmentVariables</key><dict><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>10</integer>
<key>Umask</key><integer>63</integer><key>ExitTimeOut</key><integer>45</integer>
<key>StandardOutPath</key><string>${xml(output)}</string><key>StandardErrorPath</key><string>${xml(output)}</string>
</dict></plist>\n`;
    await writeFile(resolve(directory, label + '.plist'), plist, { mode: 0o600 });
  }
  console.log(
    'Prepared Pado public environment and two LaunchAgent definitions; no service changed.',
  );
}
if (action === 'install') {
  const target = resolve(homedir(), 'Library/LaunchAgents');
  await mkdir(target, { recursive: true });
  for (const label of labels) {
    try {
      execFileSync('launchctl', ['print', domain + '/' + label], { stdio: 'ignore' });
      throw new Error('Pado service already loaded; stop it explicitly before replacement');
    } catch (error) {
      if (!('status' in error)) throw error;
    }
    const source = await readFile(resolve(directory, label + '.plist'));
    const destination = resolve(target, label + '.plist');
    // Do not overwrite an existing owner-managed definition silently.
    await writeFile(destination, source, { mode: 0o600, flag: 'wx' });
    execFileSync('launchctl', ['bootstrap', domain, destination], { stdio: 'pipe' });
    console.log(label + ': installed');
  }
}
if (action === 'status') {
  for (const label of labels) {
    try {
      const status = execFileSync('launchctl', ['print', domain + '/' + label], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      console.log(label + ': ' + (status.match(/state = (\w+)/)?.[1] || 'loaded'));
    } catch {
      console.log(label + ': not loaded');
    }
  }
}

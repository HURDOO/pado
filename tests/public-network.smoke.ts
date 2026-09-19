import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { secureContainerNetwork } from '../server/container-network.ts';

const exec = promisify(execFile);
const name = `pado-app-${randomUUID()}`;
process.env.PADO_PUBLIC_MODE = '1';
process.env.PADO_AGENT_IMAGE = 'pado-agent:public-candidate';
try {
  await exec('docker', [
    'run',
    '-d',
    '--name',
    name,
    '--read-only',
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges',
    '--memory=128m',
    '--pids-limit=32',
    '--tmpfs=/tmp:rw,nosuid,size=16m',
    process.env.PADO_AGENT_IMAGE,
    'node',
    '/opt/pado/network-gate.mjs',
    'node',
    '-e',
    'setInterval(()=>{},1000)',
  ]);
  await secureContainerNetwork(name);
  const result = await exec(
    'docker',
    [
      'exec',
      name,
      'node',
      '--input-type=module',
      '-e',
      `
    const blocked=[];
    for(const host of ['host.docker.internal','192.168.10.13','192.168.10.1','169.254.169.254','100.100.100.100']) {
      let allowed=false; try { const r=await fetch('http://'+host+':4173/api/health',{signal:AbortSignal.timeout(1200)}); await r.body?.cancel(); allowed=true; } catch {}
      blocked.push(!allowed);
    }
    const external=await fetch('https://registry.npmjs.org/-/ping',{signal:AbortSignal.timeout(10000)}).then(r=>r.ok,()=>false);
    console.log(JSON.stringify({blocked,external}));
  `,
    ],
    { timeout: 20000 },
  );
  const resultData = JSON.parse(result.stdout);
  assert.deepEqual(resultData.blocked, [true, true, true, true, true]);
  assert.equal(resultData.external, true);
  const capability = await exec('docker', [
    'exec',
    name,
    'sh',
    '-c',
    'iptables -P OUTPUT ACCEPT >/dev/null 2>&1; test $? -ne 0',
  ]);
  assert.equal(capability.stderr, '');
  console.log(
    'Public container network: host/LAN/metadata blocked, registry HTTPS allowed, policy immutable to app UID.',
  );
} finally {
  await exec('docker', ['stop', '--timeout', '1', name]).catch(() => {});
}

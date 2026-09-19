import { spawnSync } from 'node:child_process';

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  console.error(
    '직접 연 터미널에서 pnpm agent:login 을 실행해 주세요. 인증 정보는 채팅에 입력하지 않습니다.',
  );
  process.exit(1);
}
const name = 'pado-agent-login';
const image = process.env.PADO_AGENT_IMAGE || 'pado-agent:local';
const existing = spawnSync('docker', ['container', 'inspect', name], { encoding: 'utf8' });
let args;
if (existing.status === 0) {
  const container = JSON.parse(existing.stdout)[0];
  if (container.Config.Labels?.['pado.role'] !== 'login') {
    console.error(
      '같은 이름의 컨테이너가 있습니다. 용도를 확인한 뒤 직접 연결해 주세요: docker start -ai pado-agent-login',
    );
    process.exit(1);
  }
  if (container.State.Running) {
    console.error('로그인 컨테이너가 이미 실행 중입니다. 기존 터미널에서 로그인을 완료해 주세요.');
    process.exit(1);
  }
  args = ['start', '-ai', name];
} else {
  args = [
    'run',
    '--name',
    name,
    '--label',
    'pado.role=login',
    '-it',
    '--init',
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges',
    '--pids-limit=128',
    '--memory=2g',
    '--mount',
    'type=volume,source=pado-agent-auth,target=/home/node/.gemini',
    image,
    'agy',
  ];
}
console.log('전용 Antigravity 환경에 로그인합니다. 완료 후 /exit 또는 Ctrl+C로 종료해 주세요.');
const result = spawnSync('docker', args, { stdio: 'inherit' });
process.exitCode = result.status ?? 1;

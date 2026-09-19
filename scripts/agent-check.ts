import { randomUUID } from 'node:crypto';
import { AgentSession } from '../server/agent-session.ts';
import { AgentRunError } from '../server/agent-stream.ts';

const session = new AgentSession({ timeoutMs: 45_000 });
const controller = new AbortController();
process.once('SIGINT', () => controller.abort());
console.log(
  '전용 Docker 환경의 Antigravity 연결을 확인합니다. 인증된 경우 짧은 모델 요청 1회를 보냅니다.',
);
try {
  const result = await session.run(
    randomUUID(),
    'Reply with exactly PADO_READY. Do not call any tools or presentation commands.',
    () => {},
    controller.signal,
  );
  if (result.response.trim() !== 'PADO_READY') throw new Error('Unexpected response');
  console.log('Antigravity 연결 확인 완료. 실제 개발 작업은 Pado에서 검증할 수 있습니다.');
} catch (error) {
  console.error(
    error instanceof AgentRunError
      ? error.message
      : '연결을 확인하지 못했습니다. Docker 이미지와 컨테이너 상태를 확인해 주세요.',
  );
  process.exitCode = 1;
}

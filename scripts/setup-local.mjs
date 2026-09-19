import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, writeFile, rename } from 'node:fs/promises';

const project = JSON.parse(await readFile('package.json', 'utf8'));
if (project.name !== 'pado') throw new Error('Run this command from the Pado project folder.');
let source;
try {
  source = await readFile('.env', 'utf8');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  source = '';
}
const configured = source.match(/^\s*PADO_ADMIN_PASSWORD\s*=\s*(.*)$/m);
const value = configured?.[1].trim().replace(/^(['"])(.*)\1$/, '$2');
if (value && value.length >= 16) {
  console.log('기존 관리자 비밀번호를 유지했습니다. 값은 출력하지 않습니다.');
} else if (value) {
  throw new Error('기존 PADO_ADMIN_PASSWORD가 너무 짧습니다. 사용자 설정을 덮어쓰지 않았습니다.');
} else {
  const line = `PADO_ADMIN_PASSWORD=${randomBytes(24).toString('base64url')}`;
  const updated = configured
    ? source.replace(configured[0], line)
    : `${source}${source.endsWith('\n') || !source ? '' : '\n'}${line}\n`;
  const temporary = `.env.${randomUUID()}.tmp`;
  await writeFile(temporary, updated, { mode: 0o600, flag: 'wx' });
  await rename(temporary, '.env');
  console.log('로컬 관리자 비밀번호를 .env에 생성했습니다. 값은 로그·채팅에 출력하지 않습니다.');
}
console.log(
  '서버 재시작 후 설정에서 관리자 모드를 열 수 있습니다. 비밀번호는 .env에서 직접 확인하세요.',
);

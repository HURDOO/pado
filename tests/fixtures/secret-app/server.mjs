import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';

const key = process.env.DEMO_API_KEY;
if (!key) throw new Error('DEMO_API_KEY is not configured');
createServer((req, res) => {
  if (req.url === '/proof') {
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        signature: createHmac('sha256', key).update('pado-demo-challenge').digest('hex'),
      }),
    );
    return;
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(
    '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>시크릿 실행 확인</title><body style="background:#10151e;color:#edf3fc;font:16px/1.6 system-ui;padding:24px"><h1>실행 환경 연결 완료</h1><p>서버가 설정된 키로 요청에 서명할 수 있습니다.</p></body></html>',
  );
}).listen(3000, '0.0.0.0', () => console.log('SECRET_APP_READY'));

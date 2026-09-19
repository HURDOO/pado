import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJsonBody } from './json-body.ts';
import { StageError } from './stage.ts';

const cookieName = '__Host-pado_preview';
const entryPath = '/__pado_preview/entry';
const sessionPath = '/__pado_preview/session';
type Grant = { port: number; epoch: string; path: string; expires: number; validate(): void };

/** Tickets never reach app requests, shared snapshots, query strings or the agent bridge. */
export class PreviewAccess {
  private tickets = new Map<string, Grant>();
  private sessions = new Map<string, Grant>();
  issue(origin: string, port: number, epoch: string, path: string, validate: () => void) {
    this.sweep();
    validate();
    if (this.tickets.size >= 1000) throw new StageError('미리보기 입장 요청이 너무 많습니다.', 429);
    if (
      !path.startsWith('/') ||
      path.startsWith('//') ||
      /[\\\r\n]/.test(path) ||
      new URL(path, origin).origin !== origin ||
      path.startsWith('/__pado_preview/')
    )
      throw new StageError('올바른 미리보기 경로가 아닙니다.', 400);
    const ticket = randomBytes(32).toString('hex');
    this.tickets.set(ticket, { port, epoch, path, validate, expires: Date.now() + 30_000 });
    return origin + entryPath + '#' + ticket;
  }
  authorize(req: IncomingMessage, port: number, epoch: string) {
    const matches = (req.headers.cookie || '')
      .split(';')
      .map((v) => v.trim())
      .filter((v) => v.startsWith(cookieName + '='));
    const grant =
      matches.length === 1 ? this.sessions.get(matches[0].slice(cookieName.length + 1)) : undefined;
    if (!grant || grant.port !== port || grant.epoch !== epoch || grant.expires <= Date.now())
      throw new StageError('미리보기를 새로고침해 주세요.', 401);
    grant.validate();
  }
  async handle(
    req: IncomingMessage,
    res: ServerResponse,
    origin: string,
    parentOrigin: string,
    port: number,
    epoch: string,
  ) {
    if (!req.url?.startsWith('/__pado_preview/')) return false;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method === 'GET' && req.url === entryPath) {
      const nonce = randomBytes(18).toString('base64');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader(
        'Content-Security-Policy',
        `default-src 'none'; script-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors ${parentOrigin}`,
      );
      res.end(
        `<!doctype html><meta charset="utf-8"><title>Pado 미리보기 연결</title><p id="status">미리보기에 연결하고 있어요…</p><script nonce="${nonce}">const ticket=location.hash.slice(1);history.replaceState(null,'',location.pathname);fetch('${sessionPath}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ticket})}).then(async r=>{if(!r.ok)throw Error();const d=await r.json();location.replace(d.path)}).catch(()=>{document.getElementById('status').textContent='미리보기를 새로고침해 주세요.'})</script>`,
      );
      return true;
    }
    if (
      req.method !== 'POST' ||
      req.url !== sessionPath ||
      req.headers.origin !== origin ||
      !req.headers['content-type']?.startsWith('application/json')
    )
      throw new StageError('허용되지 않은 미리보기 입장 요청입니다.', 403);
    const value = (await readJsonBody(req)) as { ticket?: unknown };
    const ticket = typeof value?.ticket === 'string' ? value.ticket : '';
    const grant = this.tickets.get(ticket);
    if (!grant || grant.port !== port || grant.epoch !== epoch || grant.expires <= Date.now())
      throw new StageError('미리보기 입장이 만료되었습니다.', 401);
    grant.validate();
    this.tickets.delete(ticket);
    this.sweep();
    if (this.sessions.size >= 2000) throw new StageError('미리보기 연결이 너무 많습니다.', 429);
    const token = randomBytes(32).toString('hex');
    this.sessions.set(token, { ...grant, expires: Date.now() + 6 * 60 * 60_000 });
    res.setHeader(
      'Set-Cookie',
      `${cookieName}=${token}; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=21600`,
    );
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ path: grant.path }));
    return true;
  }
  sweep() {
    for (const map of [this.tickets, this.sessions])
      for (const [key, grant] of map) {
        try {
          if (grant.expires <= Date.now()) throw new Error('Expired');
          grant.validate();
        } catch {
          map.delete(key);
        }
      }
  }
}

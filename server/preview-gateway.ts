import {
  createServer,
  request,
  type IncomingMessage,
  type ServerResponse,
  type OutgoingHttpHeaders,
} from 'node:http';
import type { Duplex } from 'node:stream';
import { previewPorts, type Pane, type PreviewInfo } from '../shared/protocol.ts';
import type { PreviewTarget } from './app-runtime.ts';
import { StageError } from './stage.ts';
import { PreviewAccess } from './preview-access.ts';

const hopHeaders = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);
export function appRequestHeaders(
  req: IncomingMessage,
  target: PreviewTarget,
  websocket = false,
  cookiePrefix?: string,
) {
  const headers: OutgoingHttpHeaders = {};
  const connection = new Set(
    String(req.headers.connection || '')
      .toLowerCase()
      .split(',')
      .map((v) => v.trim()),
  );
  for (const [name, value] of Object.entries(req.headers)) {
    if (
      hopHeaders.has(name) ||
      connection.has(name) ||
      ['host', 'cookie', 'authorization', 'origin', 'referer', 'forwarded'].includes(name) ||
      name.startsWith('x-forwarded-') ||
      name.startsWith('cf-') ||
      name.startsWith('x-pado-') ||
      name.startsWith('sec-fetch-')
    )
      continue;
    headers[name] = value;
  }
  // Ports are separate origins, but cookies are host-scoped. Never pass Pado authentication
  // to the untrusted app, including cookies shadowing the original at a different path.
  const cookies = req.headers.cookie?.split(';').flatMap((value) => {
    const cookie = value.trim();
    if (cookiePrefix && !cookie.startsWith(cookiePrefix)) return [];
    const translated = cookiePrefix ? cookie.slice(cookiePrefix.length) : cookie;
    return /^(?:__Host-)?pado_(?:session|preview)\s*=/i.test(translated) ? [] : [translated];
  });
  if (cookies?.length) headers.cookie = cookies.join(';');
  headers.host = `127.0.0.1:${target.port}`;
  if (req.headers.origin) headers.origin = `http://127.0.0.1:${target.port}`;
  if (websocket) {
    headers.connection = 'Upgrade';
    headers.upgrade = 'websocket';
  }
  return headers;
}
export function appResponseCookies(values: string[] | undefined, prefix?: string) {
  return values
    ?.filter(
      (value) =>
        !/^\s*(?:__Host-)?pado_(?:session|preview)\s*=/i.test(value) && !/;\s*domain=/i.test(value),
    )
    .map((value) => {
      if (!prefix) return value;
      // Cookies ignore ports. Isolate server sessions; document.cookie state is unsupported.
      return (
        prefix +
        value.trim().replace(/;\s*samesite=[^;]*/gi, '') +
        (/;\s*httponly(?:;|$)/i.test(value) ? '' : '; HttpOnly') +
        '; SameSite=Strict'
      );
    });
}
export function previewPolicy(previewOrigin: string, parentOrigins: string[]) {
  return `default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ${previewOrigin.replace(/^http/, 'ws')}; frame-src 'none'; object-src 'none'; worker-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors ${parentOrigins.join(' ')}; sandbox allow-scripts allow-forms allow-same-origin`;
}
type Options = {
  bindHost: string;
  origin: string;
  basePort: number;
  parentOrigins: string[];
  publicOrigins?: Map<number, string>;
  cookiePrefix?: string;
  authorize(req: IncomingMessage): void;
  published(port: number): boolean;
  readOnly?(): boolean;
  target(port: number): PreviewTarget | undefined;
  state(): Pick<PreviewInfo, 'state' | 'epoch'>;
};
export class PreviewGateway {
  private access = new PreviewAccess();
  private servers: ReturnType<typeof createServer>[] = [];
  private connections = new Set<{
    port: number;
    epoch: string;
    req: IncomingMessage;
    upgrade: boolean;
    destroy(): void;
  }>();
  constructor(private options: Options) {
    const parent = new URL(options.origin);
    if (parent.protocol !== 'http:' && !options.publicOrigins)
      throw new Error('HTTPS preview requires separate configured public origins');
    if (options.publicOrigins) {
      const origins = previewPorts.map((port) => options.publicOrigins!.get(port));
      if (
        parent.protocol !== 'https:' ||
        new Set(origins).size !== previewPorts.length ||
        origins.some(
          (value) =>
            !value ||
            new URL(value).origin !== value ||
            new URL(value).protocol !== 'https:' ||
            value === parent.origin,
        )
      )
        throw new Error('Invalid public preview origins');
    }
    if (
      !Number.isInteger(options.basePort) ||
      options.basePort < 1024 ||
      options.basePort + previewPorts.length > 65535
    )
      throw new Error('Invalid preview base port');
    if (
      Number(parent.port || 80) >= options.basePort &&
      Number(parent.port || 80) < options.basePort + previewPorts.length
    )
      throw new Error('Preview origins must differ from the Pado origin');
  }
  origin(port: number, hostname = new URL(this.options.origin).hostname) {
    const index = previewPorts.indexOf(port as (typeof previewPorts)[number]);
    if (index < 0) throw new StageError('허용되지 않은 앱 포트입니다.', 400);
    if (this.options.publicOrigins) return this.options.publicOrigins.get(port)!;
    if (!this.options.parentOrigins.some((value) => new URL(value).hostname === hostname))
      throw new StageError('허용되지 않은 앱 호스트입니다.', 403);
    const origin = new URL(this.options.origin);
    origin.hostname = hostname;
    origin.port = String(this.options.basePort + index);
    return origin.origin;
  }
  info(pane: Pane, host?: string): PreviewInfo {
    if (!pane.server || pane.kind !== 'browser')
      throw new StageError('실행 서버 Browser pane이 아닙니다.', 404);
    return {
      ...this.options.state(),
      url:
        this.origin(pane.server.port, host ? new URL(`http://${host}`).hostname : undefined) +
        pane.server.path,
    };
  }
  entry(pane: Pane, req: IncomingMessage) {
    const info = this.info(pane, req.headers.host);
    if (!this.options.publicOrigins) return info.url;
    const port = pane.server!.port;
    if (!this.options.published(port) || !this.options.target(port))
      throw new StageError('미리보기 서버가 준비되지 않았습니다.', 409);
    return this.access.issue(this.origin(port), port, info.epoch, pane.server!.path, () =>
      this.options.authorize(req),
    );
  }
  private requestOrigin(req: IncomingMessage, port: number) {
    const expected = this.origin(port, new URL(`http://${req.headers.host}`).hostname);
    if (req.headers.host !== new URL(expected).host)
      throw new StageError('허용되지 않은 미리보기 호스트입니다.', 403);
    return expected;
  }
  private session(req: IncomingMessage, port: number) {
    if (this.options.publicOrigins) this.access.authorize(req, port, this.options.state().epoch);
    else this.options.authorize(req);
  }
  private authorize(req: IncomingMessage, port: number, upgrade = false) {
    const expected = this.requestOrigin(req, port);
    if (req.headers.origin && req.headers.origin !== expected)
      throw new StageError('허용되지 않은 미리보기 출처입니다.', 403);
    if (
      (upgrade || !['GET', 'HEAD', 'OPTIONS'].includes(req.method || '')) &&
      req.headers.origin !== expected
    )
      throw new StageError('앱 요청 출처가 필요합니다.', 403);
    // oxlint-disable-next-line no-control-regex
    if (!req.url?.startsWith('/') || req.url.startsWith('//') || /[\\\u0000-\u0020]/.test(req.url))
      throw new StageError('올바른 앱 경로가 아닙니다.', 400);
    if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(req.method || ''))
      throw new StageError('지원하지 않는 앱 요청입니다.', 405);
    this.session(req, port);
    if (
      this.options.readOnly?.() &&
      (upgrade || !['GET', 'HEAD', 'OPTIONS'].includes(req.method || ''))
    )
      throw new StageError('읽기 전용 프로젝트에서는 앱 데이터를 변경할 수 없습니다.', 403);
    if (!this.options.published(port))
      throw new StageError('이 앱 서버는 현재 stage에 공개되지 않았습니다.', 403);
    const target = this.options.target(port);
    if (!target)
      throw new StageError(
        '앱 서버가 중지되어 있습니다. 에이전트에게 서버 실행을 요청해 주세요.',
        503,
      );
    if (this.connections.size >= 1000) throw new StageError('앱 연결이 너무 많습니다.', 503);
    return target;
  }
  private headers(
    upstream: IncomingMessage,
    target: PreviewTarget,
    port: number,
    publicOrigin: string,
  ) {
    const headers: OutgoingHttpHeaders = {};
    const connection = new Set(
      String(upstream.headers.connection || '')
        .toLowerCase()
        .split(',')
        .map((value) => value.trim()),
    );
    for (const [name, value] of Object.entries(upstream.headers)) {
      if (
        hopHeaders.has(name) ||
        connection.has(name) ||
        [
          'content-security-policy',
          'content-security-policy-report-only',
          'x-frame-options',
          'set-cookie',
          'location',
          'refresh',
          'clear-site-data',
          'service-worker-allowed',
        ].includes(name) ||
        name.startsWith('access-control-')
      )
        continue;
      headers[name] = value;
    }
    const cookies = appResponseCookies(upstream.headers['set-cookie'], this.options.cookiePrefix);
    if (cookies?.length) headers['set-cookie'] = cookies;
    if (upstream.headers.location) {
      const location = new URL(upstream.headers.location, `http://127.0.0.1:${target.port}`);
      if (
        !['http:', 'https:'].includes(location.protocol) ||
        !['127.0.0.1', 'localhost'].includes(location.hostname) ||
        ![target.port, port].includes(Number(location.port || 80))
      )
        throw new StageError('외부 주소로 이동하는 앱 응답은 허용하지 않습니다.', 502);
      headers.location = publicOrigin + location.pathname + location.search + location.hash;
    }
    headers['content-security-policy'] = previewPolicy(publicOrigin, this.options.parentOrigins);
    headers['x-content-type-options'] = 'nosniff';
    headers['referrer-policy'] = 'no-referrer';
    headers['permissions-policy'] = 'camera=(), microphone=(), geolocation=(), payment=()';
    headers['cache-control'] = 'no-store';
    return headers;
  }
  private error(res: ServerResponse, error: unknown) {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    res.writeHead(error instanceof StageError ? error.status : 502, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(
      error instanceof StageError
        ? error.message
        : '앱 서버에 연결하지 못했습니다. 서버 로그를 확인하고 새로고침해 주세요.',
    );
  }
  private async http(req: IncomingMessage, res: ServerResponse, port: number) {
    try {
      const publicOrigin = this.requestOrigin(req, port);
      if (
        this.options.publicOrigins &&
        (await this.access.handle(
          req,
          res,
          publicOrigin,
          this.options.origin,
          port,
          this.options.state().epoch,
        ))
      )
        return;
      const target = this.authorize(req, port);
      if (Number(req.headers['content-length'] || 0) > 2_000_000)
        throw new StageError('앱 요청 크기를 초과했습니다.', 413);
      const upstream = request(
        {
          host: target.host,
          port: target.port,
          path: req.url,
          method: req.method,
          headers: appRequestHeaders(req, target, false, this.options.cookiePrefix),
        },
        (response) => {
          try {
            res.writeHead(
              response.statusCode || 502,
              this.headers(response, target, port, publicOrigin),
            );
          } catch (error) {
            response.destroy();
            this.error(res, error);
            return;
          }
          let bytes = 0;
          response.on('data', (chunk) => {
            bytes += chunk.length;
            if (bytes > 64_000_000) {
              response.destroy();
              res.destroy();
            }
          });
          response.on('error', () => res.destroy());
          response.pipe(res);
        },
      );
      const connection = {
        port,
        epoch: target.epoch,
        req,
        upgrade: false,
        destroy: () => {
          upstream.destroy();
          res.destroy();
        },
      };
      this.connections.add(connection);
      let bytes = 0;
      req.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > 2_000_000) {
          upstream.destroy();
          this.error(res, new StageError('앱 요청 크기를 초과했습니다.', 413));
        }
      });
      req.on('aborted', () => upstream.destroy());
      res.on('close', () => {
        this.connections.delete(connection);
        upstream.destroy();
      });
      upstream.on('error', () => this.error(res, new Error('App unavailable')));
      upstream.setTimeout(60_000, () => upstream.destroy());
      req.pipe(upstream);
    } catch (error) {
      this.error(res, error);
    }
  }
  private upgrade(req: IncomingMessage, socket: Duplex, head: Buffer, port: number) {
    try {
      const target = this.authorize(req, port, true);
      if (req.headers.upgrade?.toLowerCase() !== 'websocket')
        throw new StageError('WebSocket 요청이 아닙니다.', 400);
      const upstream = request({
        host: target.host,
        port: target.port,
        path: req.url,
        headers: appRequestHeaders(req, target, true, this.options.cookiePrefix),
      });
      let peer: Duplex | undefined;
      const connection = {
        port,
        epoch: target.epoch,
        req,
        upgrade: true,
        destroy: () => {
          upstream.destroy();
          peer?.destroy();
          socket.destroy();
        },
      };
      this.connections.add(connection);
      const cleanup = () => {
        this.connections.delete(connection);
        upstream.destroy();
        peer?.destroy();
      };
      socket.on('error', cleanup);
      socket.on('close', cleanup);
      upstream.on('error', () => socket.destroy());
      upstream.on('response', (response) => {
        response.resume();
        socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');
      });
      upstream.on('upgrade', (response, remote, remoteHead) => {
        peer = remote;
        const lines = [
          'HTTP/1.1 101 Switching Protocols',
          'Connection: Upgrade',
          'Upgrade: websocket',
        ];
        for (const name of [
          'sec-websocket-accept',
          'sec-websocket-protocol',
          'sec-websocket-extensions',
        ]) {
          const value = response.headers[name];
          if (typeof value === 'string') lines.push(`${name}: ${value}`);
        }
        socket.write(lines.join('\r\n') + '\r\n\r\n');
        if (remoteHead.length) socket.write(remoteHead);
        if (head.length) remote.write(head);
        remote.on('error', () => socket.destroy());
        remote.on('close', () => socket.destroy());
        socket.pipe(remote).pipe(socket);
      });
      upstream.setTimeout(10000, () => {
        if (!peer) upstream.destroy();
      });
      upstream.end();
    } catch (error) {
      socket.end(
        `HTTP/1.1 ${error instanceof StageError ? error.status : 502} Preview Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
      );
    }
  }
  sweep() {
    this.access.sweep();
    for (const connection of this.connections) {
      try {
        this.session(connection.req, connection.port);
        if (
          (this.options.readOnly?.() &&
            (connection.upgrade ||
              !['GET', 'HEAD', 'OPTIONS'].includes(connection.req.method || ''))) ||
          !this.options.published(connection.port) ||
          this.options.target(connection.port)?.epoch !== connection.epoch
        )
          throw new Error('Closed');
      } catch {
        connection.destroy();
        this.connections.delete(connection);
      }
    }
  }
  async listen() {
    try {
      for (const port of previewPorts) {
        const server = createServer((req, res) => void this.http(req, res, port));
        server.on('upgrade', (req, socket, head) => this.upgrade(req, socket, head, port));
        server.requestTimeout = 30000;
        server.headersTimeout = 10000;
        this.servers.push(server);
        await new Promise<void>((ok, fail) => {
          server.once('error', fail);
          server.listen(
            this.options.basePort + previewPorts.indexOf(port),
            this.options.bindHost,
            ok,
          );
        });
      }
    } catch (error) {
      await this.close();
      throw error;
    }
  }
  async close() {
    for (const connection of this.connections) connection.destroy();
    this.connections.clear();
    await Promise.all(
      this.servers.map(
        (server) =>
          new Promise<void>((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      ),
    );
    this.servers = [];
  }
}

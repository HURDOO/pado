import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { z } from 'zod';
import type { ViteDevServer } from 'vite';
import {
  presentationSchema,
  addPaneSchema,
  paneSchema,
  projectSchema,
  secretValueSchema,
  previewPorts,
  type Project,
  type Session,
  type Snapshot,
} from '../shared/protocol.ts';
import { StageError, StageStore } from './stage.ts';
import { Runner } from './runner.ts';
import { readJsonBody } from './json-body.ts';
import { PreviewGateway } from './preview-gateway.ts';
import { Projects } from './projects.ts';
import { ShellSessions } from './shell-sessions.ts';
import { publicPreviewOrigin, visitorAddress } from './public-origin.ts';
import { publicMode, participantTuiEnabled } from './container-network.ts';
import { assertPublicStorage } from './public-resources.ts';

const port = Number(process.env.PADO_PORT || 4173);
const bindHost = process.env.PADO_BIND_HOST || '127.0.0.1';
const origin = process.env.PADO_ORIGIN || `http://127.0.0.1:${port}`;
const configuredOrigin = new URL(origin);
const secureOrigin = configuredOrigin.protocol === 'https:';
const sessionCookieName = secureOrigin ? '__Host-pado_session' : 'pado_session';
const trustCloudflare = process.env.PADO_TRUST_CLOUDFLARE === '1';
if (trustCloudflare && (!secureOrigin || bindHost !== '127.0.0.1'))
  throw new Error('Cloudflare forwarding requires an HTTPS origin and loopback binding');
const local = ['127.0.0.1', 'localhost'].includes(configuredOrigin.hostname);
const origins = new Set([
  origin,
  ...(local ? [`http://localhost:${port}`, `http://127.0.0.1:${port}`] : []),
]);
const hosts = new Set([...origins].map((value) => new URL(value).host));
const adminPassword = process.env.PADO_ADMIN_PASSWORD || '';
if (
  adminPassword &&
  adminPassword.length < 16 &&
  process.env.PADO_DEMO_SHORT_ADMIN_PASSWORD !== '1'
)
  throw new Error('PADO_ADMIN_PASSWORD must be at least 16 characters.');
const runnerMode = process.env.PADO_RUNNER === 'antigravity' ? 'antigravity' : 'rehearsal';
const projects = await new Projects().init();
let activeId = projects.active.id;
let switching = false;
let activeActions = 0;
type ProjectSession = {
  id: string;
  store: StageStore;
  runner: Runner;
  shells: ShellSessions;
  preview?: PreviewGateway;
  saveTimer?: ReturnType<typeof setTimeout>;
  resourceTimer?: ReturnType<typeof setInterval>;
  resourceBlocked?: boolean;
};
const projectSessions = new Map<string, ProjectSession>();
const openingProjects = new Map<string, Promise<ProjectSession>>();
type StoredSession = {
  me: Session;
  expiresAt: number;
  // An omitted project follows the designated stage; a selected project stays pinned per tab.
  streams: Map<ServerResponse, string | undefined>;
  terminals: Map<ServerResponse, string>;
};
const sessions = new Map<string, StoredSession>();
const rates = new Map<string, { count: number; expiresAt: number }>();
const production = process.argv.includes('--production');
if (production && secureOrigin && (!publicMode() || !trustCloudflare || !adminPassword))
  throw new Error(
    'Public production requires isolation, a loopback Cloudflare proxy and administrator authentication',
  );
let vite: ViteDevServer | null = null;
function projectPreview(project: Project, store: StageStore, runner: Runner) {
  return store.state.runner === 'antigravity'
    ? new PreviewGateway({
        bindHost,
        origin,
        // Distinct browser origins prevent an old project's JS/storage from reaching a new app.
        basePort: Number(process.env.PADO_PREVIEW_BASE_PORT || port + 100) + project.slot * 4,
        parentOrigins: [...origins],
        ...(secureOrigin
          ? {
              publicOrigins: new Map(
                previewPorts.map((port) => [port, publicPreviewOrigin(origin, project.slot, port)]),
              ),
            }
          : {}),
        cookiePrefix: `pado_app_${project.id}_`,
        authorize: (req) => {
          session(req, false);
        },
        published: (port) => store.publishesPreview(port),
        readOnly: () => switching || activeId !== project.id,
        target: (port) => runner.tui.runtime.target(port),
        state: () => ({
          state: runner.tui.runtime.state,
          epoch: runner.tui.runtime.epoch,
        }),
      })
    : undefined;
}
function workspace(viewedId = activeId) {
  const active = projectSessions.get(activeId)!;
  return {
    activeId,
    viewedId,
    projects: projects.list(),
    switching,
    activeBusy: active.store.interactionBusy || activeActions > 0,
  };
}
function openProject(id: string): Promise<ProjectSession> {
  projects.get(id);
  const existing = openingProjects.get(id);
  if (existing) return existing;
  const opening = (async () => {
    const store = new StageStore(runnerMode);
    store.restore(await projects.load(id));
    const runner = new Runner(store, {
      ...projects.paths(id),
      conversation: await projects.conversation(id),
      onConversation: (conversation) => projects.saveConversation(id, conversation),
      app: await projects.app(id),
      onApp: (request) => projects.saveApp(id, request),
    });
    const preview = projectPreview(projects.get(id), store, runner);
    await preview?.listen();
    const shells = new ShellSessions(store, projects.paths(id).workspace);
    const context: ProjectSession = { id, store, runner, shells, preview };
    for (const s of sessions.values()) {
      store.join(s.me);
      store.presence(s.me.id, s.streams.size > 0);
    }
    projectSessions.set(id, context);
    if (publicMode()) {
      await mkdir(projects.paths(id).workspace, { recursive: true });
      let checking = false;
      const check = async () => {
        if (checking || context.resourceBlocked) return;
        checking = true;
        try {
          await assertPublicStorage(projects.paths(id).workspace);
        } catch {
          context.resourceBlocked = true;
          await Promise.allSettled([shells.stop(), runner.stop(true)]);
          console.error('Public project paused: storage safety check failed.');
        } finally {
          checking = false;
        }
      };
      await check();
      context.resourceTimer = setInterval(() => void check(), 2000);
      context.resourceTimer.unref();
    }
    store.subscribe(() => {
      shells.reconcile();
      preview?.sweep();
      clearTimeout(context.saveTimer);
      context.saveTimer = setTimeout(() => {
        void projects
          .save(id, store.checkpoint())
          .catch(() => console.error('Project presentation state could not be saved.'));
      }, 200);
      context.saveTimer.unref();
      broadcastState();
    });
    runner.tui.runtime.subscribe(() => store.publish());
    runner.tui.subscribe((frame) => {
      const event = `event: terminal\ndata: ${JSON.stringify(frame)}\n\n`;
      for (const s of sessions.values())
        for (const [stream, projectId] of s.terminals) {
          if (projectId !== id) continue;
          if (stream.writableLength > 512_000) stream.destroy();
          else stream.write(event);
        }
    });
    return context;
  })();
  openingProjects.set(id, opening);
  void opening.catch(() => openingProjects.delete(id));
  return opening;
}
async function warmProject(context: ProjectSession) {
  if (runnerMode !== 'antigravity' || context.resourceBlocked) return;
  // Independent failures must not take down other projects or expose raw runner diagnostics.
  await Promise.allSettled([
    context.runner.tui.ensure(),
    context.runner.tui.resumeApp(false, true),
  ]);
}
async function switchProject(id: string) {
  projects.get(id);
  if (switching || activeActions || projectSessions.get(activeId)!.store.interactionBusy)
    throw new StageError('작업과 발언권을 마친 뒤 프로젝트를 전환해 주세요.');
  if (id === activeId) return;
  switching = true;
  broadcastState();
  try {
    await openProject(id);
    await projects.activate(id);
    activeId = id;
  } finally {
    switching = false;
    for (const context of projectSessions.values()) context.preview?.sweep();
    broadcastState();
  }
}

function json(res: ServerResponse, code: number, body: unknown) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(body));
}
function rate(key: string, max: number, cost = 1) {
  const now = Date.now();
  let entry = rates.get(key);
  if (!entry || entry.expiresAt <= now) {
    entry = { count: 0, expiresAt: now + 60_000 };
    rates.set(key, entry);
  }
  entry.count += cost;
  if (entry.count > max)
    throw new StageError(
      '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
      429,
      Math.max(1, Math.ceil((entry.expiresAt - now) / 1000)),
    );
}
function session(req: IncomingMessage, refresh = true) {
  const token = req.headers.cookie
    ?.split(';')
    .map((v) => v.trim())
    .find((v) => v.startsWith(sessionCookieName + '='))
    ?.slice(sessionCookieName.length + 1);
  const entry = token ? sessions.get(token) : undefined;
  if (!entry || entry.expiresAt <= Date.now()) throw new StageError('다시 입장해 주세요.', 401);
  if (refresh) entry.expiresAt = Date.now() + 6 * 60 * 60_000;
  return entry;
}
async function body(req: IncomingMessage): Promise<unknown> {
  if (!req.headers['content-type']?.startsWith('application/json'))
    throw new StageError('JSON 요청이 필요합니다.', 415);
  return readJsonBody(req);
}
function snapshot(s: StoredSession, viewedId = activeId): Snapshot {
  const { store } = projectSessions.get(viewedId)!;
  return {
    stage: { ...store.state, serverTime: Date.now() },
    me: s.me,
    adminAvailable: !!adminPassword,
    publicMode: publicMode(),
    participantTui: participantTuiEnabled(),
    workspace: workspace(viewedId),
  };
}
function sendState(s: StoredSession, stream: ServerResponse, projectId = activeId) {
  if (stream.writableLength > 512_000) {
    stream.destroy();
    return;
  }
  stream.write(`event: state\ndata: ${JSON.stringify(snapshot(s, projectId))}\n\n`);
}
// Coalesce stdout bursts while keeping authoritative snapshots ordered.
let scheduled = false;
function broadcastState() {
  if (scheduled) return;
  scheduled = true;
  setTimeout(() => {
    scheduled = false;
    for (const s of sessions.values())
      for (const [res, projectId] of s.streams) sendState(s, res, projectId);
  }, 30).unref();
}
const server = createServer(async (req, res) => {
  let projectAction = false;
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  try {
    if (!req.headers.host || !hosts.has(req.headers.host))
      throw new StageError('허용되지 않은 호스트입니다.', 403);
    const url = new URL(req.url || '/', origin);
    if (!url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD')
        throw new StageError('지원하지 않는 요청입니다.', 405);
      if (vite) {
        vite.middlewares(req, res, () => json(res, 404, { error: 'Not found' }));
        return;
      }
      const root = resolve('web/dist');
      const path = resolve(root, '.' + decodeURIComponent(url.pathname));
      if (path !== root && !path.startsWith(root + sep)) throw new StageError('Not found', 404);
      const file = await stat(path)
        .then((s) => (s.isFile() ? path : resolve(root, 'index.html')))
        .catch(() => resolve(root, 'index.html'));
      const mime: Record<string, string> = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
        '.ico': 'image/x-icon',
      };
      res.setHeader('Content-Type', mime[extname(file)] || 'application/octet-stream');
      res.setHeader(
        'Cache-Control',
        file.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
      );
      res.end(await readFile(file));
      return;
    }
    if (req.method === 'POST' && (!req.headers.origin || !origins.has(req.headers.origin)))
      throw new StageError('허용되지 않은 요청 출처입니다.', 403);
    const ip = visitorAddress(req, trustCloudflare);
    if (url.pathname === '/api/health' && req.method === 'GET') {
      json(res, 200, { ok: true, runner: runnerMode, publicMode: publicMode(), production });
      return;
    }
    if (url.pathname === '/api/join' && req.method === 'POST') {
      rate(`join:${ip}`, 20);
      const { nickname } = z
        .object({
          nickname: z
            .string()
            .trim()
            .min(1)
            .max(24)
            .regex(/^[^\p{Cc}\p{Cf}]+$/u),
        })
        .parse(await body(req));
      try {
        const existing = session(req);
        json(res, 200, snapshot(existing));
        return;
      } catch {
        /* New visitor */
      }
      const token = randomBytes(32).toString('hex');
      const s: StoredSession = {
        me: { id: randomBytes(12).toString('hex'), nickname, admin: false },
        expiresAt: Date.now() + 6 * 60 * 60_000,
        streams: new Map(),
        terminals: new Map(),
      };
      for (const { store } of projectSessions.values()) store.join(s.me);
      sessions.set(token, s);
      res.setHeader(
        'Set-Cookie',
        `${sessionCookieName}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=21600${secureOrigin ? '; Secure' : ''}`,
      );
      json(res, 200, snapshot(s));
      return;
    }
    const s = session(req);
    const expected = req.headers['x-pado-project'] ?? url.searchParams.get('project');
    const projectId = expected == null ? activeId : projectSchema.shape.id.parse(expected);
    projects.get(projectId);
    const { store, runner, shells, preview } = await openProject(projectId);
    if (req.method === 'POST' && projectSessions.get(projectId)?.resourceBlocked)
      throw new StageError(
        '저장 공간 안전 점검으로 프로젝트가 중지되었습니다. 관리자에게 알려 주세요.',
        503,
      );
    const projectBound = ![
      '/api/me',
      '/api/events',
      '/api/admin/login',
      '/api/admin/logout',
      '/api/admin/projects',
      '/api/admin/projects/select',
      '/api/admin/projects/rename',
    ].includes(url.pathname);
    if (projectBound) {
      if (req.method === 'POST') {
        if (projectId !== activeId)
          throw new StageError(
            '읽기 전용 프로젝트입니다. 참여 프로젝트에서만 조작할 수 있습니다.',
            403,
          );
        if (switching)
          throw new StageError('프로젝트를 지정하고 있습니다. 잠시 후 다시 시도해 주세요.');
        activeActions++;
        projectAction = true;
      }
    }
    if (url.pathname.startsWith('/api/preview/') && req.method === 'GET') {
      const pane = store.state.panes.find(
        (pane) => pane.id === url.pathname.slice('/api/preview/'.length),
      );
      if (!pane || !preview) throw new StageError('앱 미리보기가 없습니다.', 404);
      const checkId = url.searchParams.get('check');
      const reproduction =
        checkId && pane.kind === 'review'
          ? pane.review?.checks.find((check) => check.id === checkId)?.reproduction
          : undefined;
      if (checkId && !reproduction) throw new StageError('재현 화면이 없습니다.', 404);
      const previewPane = reproduction
        ? { ...pane, kind: 'browser' as const, server: reproduction }
        : pane;
      if (url.searchParams.get('access') === '1') {
        // This grants viewing access only, including to inactive projects.
        rate(`preview-access:${s.me.id}`, 120);
        json(res, 200, { url: preview.entry(previewPane, req) });
        return;
      }
      json(res, 200, preview.info(previewPane, req.headers.host));
      return;
    }
    if (url.pathname === '/api/me' && req.method === 'GET') {
      json(res, 200, snapshot(s, projectId));
      return;
    }
    if (url.pathname === '/api/panes' && req.method === 'GET') {
      json(res, 200, { panes: store.knownPanes() });
      return;
    }
    const shellRoute = /^\/api\/shell\/([a-zA-Z0-9_-]{1,64})\/(events|input|resize|start)$/.exec(
      url.pathname,
    );
    if (shellRoute) {
      const [, id, operation] = shellRoute;
      if (operation === 'events' && req.method === 'GET') {
        const initial = shells.snapshot(id);
        if (s.terminals.size >= 24)
          throw new StageError('열려 있는 터미널 연결이 너무 많습니다.', 429);
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        s.terminals.set(res, `shell:${projectId}:${id}`);
        const unsubscribe = shells.subscribe((paneId, frame) => {
          if (paneId !== id) return;
          if (res.writableLength > 512_000) res.destroy();
          else res.write(`event: terminal\ndata: ${JSON.stringify(frame)}\n\n`);
        });
        res.write(`event: terminal\ndata: ${JSON.stringify(initial)}\n\n`);
        req.on('close', () => {
          unsubscribe();
          s.terminals.delete(res);
        });
        return;
      }
      if (req.method !== 'POST') throw new StageError('Not found', 404);
      store.assertPaneControl(s.me);
      if (operation === 'input') {
        rate(`shell-input:${s.me.id}`, 1800);
        const { data, epoch } = z
          .object({ data: z.string().min(1).max(8192), epoch: z.uuid() })
          .strict()
          .parse(await body(req));
        rate(`shell-bytes:${s.me.id}`, 128_000, Buffer.byteLength(data));
        shells.input(s.me, id, data, epoch);
      } else if (operation === 'resize') {
        rate(`shell-resize:${s.me.id}`, 120);
        const { cols, rows, epoch } = z
          .object({
            cols: z.number().int().min(30).max(200),
            rows: z.number().int().min(10).max(80),
            epoch: z.uuid(),
          })
          .strict()
          .parse(await body(req));
        await shells.resize(s.me, id, cols, rows, epoch);
      } else if (operation === 'start') {
        rate(`shell-start:${s.me.id}`, 10);
        await shells.start(s.me, id);
      } else throw new StageError('Not found', 404);
      json(res, 200, { ok: true });
      return;
    }
    if (url.pathname.startsWith('/api/tui/')) {
      if (store.state.runner !== 'antigravity') throw new StageError('TUI 모드가 아닙니다.', 404);
      if (url.pathname === '/api/tui/snapshot' && req.method === 'GET') {
        json(res, 200, runner.tui.snapshot());
        return;
      }
      if (url.pathname === '/api/tui/events' && req.method === 'GET') {
        if ([...s.terminals.values()].filter((id) => !id.startsWith('shell:')).length >= 5)
          throw new StageError('열려 있는 TUI 탭이 너무 많습니다.', 429);
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        s.terminals.set(res, projectId);
        res.write(`event: terminal\ndata: ${JSON.stringify(runner.tui.snapshot())}\n\n`);
        req.on('close', () => s.terminals.delete(res));
        // An idle stopped TUI is restarted by its next controller, not by reconnect loops.
        if (
          !projectSessions.get(projectId)?.resourceBlocked &&
          runner.tui.snapshot().status === 'starting'
        )
          void runner.tui.ensure().catch(() => {});
        return;
      }
      if (url.pathname === '/api/tui/input' && req.method === 'POST') {
        if (!participantTuiEnabled() && !s.me.admin)
          throw new StageError('공개 참여자는 프롬프트 입력창을 사용해 주세요.', 403);
        rate(`tui-input:${s.me.id}`, 1800);
        const { data } = z.object({ data: z.string().min(1).max(8192) }).parse(await body(req));
        rate(`tui-bytes:${s.me.id}`, 128_000, Buffer.byteLength(data));
        await runner.tui.input(s.me, data);
        json(res, 200, { ok: true });
        return;
      }
      if (url.pathname === '/api/tui/resize' && req.method === 'POST') {
        rate(`tui-resize:${s.me.id}`, 120);
        const { cols, rows } = z
          .object({
            cols: z.number().int().min(30).max(200),
            rows: z.number().int().min(10).max(80),
          })
          .parse(await body(req));
        await runner.tui.resize(s.me, cols, rows);
        json(res, 200, { ok: true });
        return;
      }
      throw new StageError('Not found', 404);
    }
    if (url.pathname === '/api/events' && req.method === 'GET') {
      if (s.streams.size >= 5) throw new StageError('열려 있는 탭이 너무 많습니다.', 429);
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      s.streams.set(res, expected == null ? undefined : projectId);
      for (const { store } of projectSessions.values()) store.presence(s.me.id, true);
      sendState(s, res, projectId);
      req.on('close', () => {
        s.streams.delete(res);
        if (!s.streams.size)
          for (const { store } of projectSessions.values()) store.presence(s.me.id, false);
      });
      return;
    }
    if (req.method !== 'POST') throw new StageError('Not found', 404);
    rate(`action:${s.me.id}`, 100);
    if (url.pathname === '/api/admin/login') {
      rate(`admin:${ip}`, 6);
      const { password } = z.object({ password: z.string().max(256) }).parse(await body(req));
      const a = Buffer.from(password);
      const b = Buffer.from(adminPassword);
      if (!adminPassword || a.length !== b.length || !timingSafeEqual(a, b))
        throw new StageError('관리자 비밀번호를 확인해 주세요.', 403);
      s.me.admin = true;
      broadcastState();
      json(res, 200, snapshot(s, projectId));
      return;
    }
    if (url.pathname.startsWith('/api/admin/') && !s.me.admin)
      throw new StageError('관리자 권한이 필요합니다.', 403);
    switch (url.pathname) {
      case '/api/panes/add': {
        store.assertPaneControl(s.me);
        const request = addPaneSchema.parse(await body(req));
        if (request.kind === 'saved') {
          store.showManualPane(request.id);
          break;
        }
        if (store.state.runner !== 'antigravity')
          throw new StageError('터미널과 서버 미리보기는 실제 실행 모드에서 사용할 수 있습니다.');
        if (request.kind === 'terminal') shells.assertCanOpen();
        const id = `user-${randomUUID()}`;
        const pane = paneSchema.parse(
          request.kind === 'terminal'
            ? {
                id,
                kind: 'terminal',
                title: '터미널',
                size: 2,
                manual: true,
                shell: true,
                terminal: {
                  runId: randomUUID(),
                  startedAt: Date.now(),
                  command: ['bash'],
                  cwd: '.',
                },
              }
            : {
                id,
                kind: 'browser',
                title: `Browser · ${request.server.port}`,
                size: 2,
                server: request.server,
              },
        );
        store.addManualPane(pane);
        if (request.kind === 'terminal') await shells.start(s.me, id);
        break;
      }
      case '/api/panes/present': {
        store.assertPaneControl(s.me);
        const event = presentationSchema.parse(await body(req));
        if (!['pane.close', 'pane.focus', 'pane.resize'].includes(event.type))
          throw new StageError('허용되지 않은 pane 조작입니다.', 400);
        if (event.type === 'pane.close') await shells.close(event.id);
        store.present(event);
        break;
      }
      case '/api/admin/projects': {
        const { name } = z.object({ name: projectSchema.shape.name }).parse(await body(req));
        if (switching) throw new StageError('프로젝트 전환을 기다려 주세요.');
        switching = true;
        try {
          const project = await projects.create(name);
          const context = await openProject(project.id);
          void warmProject(context);
        } finally {
          switching = false;
          broadcastState();
        }
        json(res, 200, snapshot(s));
        return;
      }
      case '/api/admin/projects/select': {
        const { id } = z.object({ id: projectSchema.shape.id }).parse(await body(req));
        await switchProject(id);
        json(res, 200, snapshot(s));
        return;
      }
      case '/api/admin/projects/rename': {
        const { id, name } = z
          .object({ id: projectSchema.shape.id, name: projectSchema.shape.name })
          .parse(await body(req));
        if (switching) throw new StageError('프로젝트 전환을 기다려 주세요.');
        switching = true;
        try {
          await projects.rename(id, name);
        } finally {
          switching = false;
          broadcastState();
        }
        json(res, 200, snapshot(s));
        return;
      }
      case '/api/raise':
        if (store.state.runner === 'antigravity') await runner.tui.ensure();
        store.raise(s.me);
        runner.tui.tick();
        break;
      case '/api/release':
        store.release(s.me);
        runner.tui.tick();
        break;
      case '/api/prompt': {
        if (store.state.runner === 'antigravity' && participantTuiEnabled())
          throw new StageError('Antigravity TUI에 직접 입력해 주세요.', 400);
        const { prompt } = z.object({ prompt: z.string().max(4000) }).parse(await body(req));
        if (store.state.runner === 'antigravity') {
          await runner.tui.submitPublicPrompt(s.me, prompt);
          break;
        }
        runner.assertReady();
        const id = store.begin(s.me, prompt);
        runner.start(id);
        break;
      }
      case '/api/input': {
        const input = z
          .object({
            paneId: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
            values: z
              .record(z.string().max(80), z.string().max(4000))
              .refine((v) => Object.keys(v).length <= 20),
          })
          .parse(await body(req));
        if (!store.canAnswer(s.me, input.paneId))
          throw new StageError('현재 작업의 요청자 또는 관리자만 답변할 수 있습니다.', 403);
        await runner.submit(input.paneId, input.values);
        break;
      }
      case '/api/input/secret': {
        const input = z
          .object({
            paneId: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
            value: secretValueSchema,
          })
          .strict()
          .parse(await body(req));
        if (!store.canAnswer(s.me, input.paneId))
          throw new StageError('현재 작업의 요청자 또는 관리자만 설정할 수 있습니다.', 403);
        await runner.submitSecret(input.paneId, input.value);
        break;
      }
      case '/api/input/error': {
        const input = z
          .object({
            paneId: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
            message: z.string().max(300),
          })
          .parse(await body(req));
        if (!store.canAnswer(s.me, input.paneId))
          throw new StageError('현재 요청자 또는 관리자만 오류를 전달할 수 있습니다.', 403);
        await runner.inputError(input.paneId, input.message);
        break;
      }
      case '/api/admin/present':
        store.present(presentationSchema.parse(await body(req)));
        break;
      case '/api/admin/revoke':
        store.release(s.me);
        runner.tui.tick();
        break;
      case '/api/admin/stop':
        await shells.stop();
        await runner.stop();
        await runner.tui.forgetApp();
        break;
      case '/api/admin/app/resume':
        if (store.state.turn) throw new StageError('현재 작업이 끝난 뒤 앱을 다시 연결해 주세요.');
        await runner.tui.resumeApp(true);
        break;
      case '/api/admin/reset':
        await shells.stop();
        await runner.stop();
        await runner.tui.forgetConversation();
        await runner.tui.forgetApp();
        store.reset();
        if (store.state.runner === 'antigravity') await runner.tui.ensure();
        break;
      case '/api/admin/logout':
        s.me.admin = false;
        broadcastState();
        break;
      default:
        throw new StageError('Not found', 404);
    }
    json(res, 200, { ok: true });
  } catch (error) {
    if (res.headersSent) {
      res.end();
      return;
    }
    if (error instanceof z.ZodError) {
      json(res, 400, { error: '입력 형식과 길이를 확인해 주세요.' });
      return;
    }
    const code = error instanceof StageError ? error.status : 500;
    if (error instanceof StageError && error.retryAfter)
      res.setHeader('Retry-After', String(error.retryAfter));
    json(res, code, {
      error: error instanceof StageError ? error.message : '요청을 처리하지 못했습니다.',
    });
  } finally {
    if (projectAction) {
      activeActions--;
      broadcastState();
    }
  }
});
server.requestTimeout = 15_000;
server.headersTimeout = 10_000;
const timer = setInterval(() => {
  for (const { store, runner, preview } of projectSessions.values()) {
    store.tick();
    runner.tui.tick();
    preview?.sweep();
  }
  for (const [key, entry] of rates) if (entry.expiresAt < Date.now()) rates.delete(key);
  for (const [token, s] of sessions) {
    if (s.expiresAt < Date.now()) {
      for (const stream of [...s.streams.keys(), ...s.terminals.keys()]) stream.end();
      sessions.delete(token);
      for (const { store } of projectSessions.values()) store.leave(s.me.id);
    } else
      for (const stream of [...s.streams.keys(), ...s.terminals.keys()]) {
        if (stream.writableLength > 512_000) stream.destroy();
        else stream.write(': heartbeat\n\n');
      }
  }
}, 1000);
timer.unref();
if (!production)
  vite = await (
    await import('vite')
  ).createServer({
    root: resolve('web'),
    server: { middlewareMode: true, ws: { server } },
    appType: 'spa',
  });
await Promise.all(projects.list().map((project) => openProject(project.id)));
server.listen(port, bindHost, () =>
  console.log(`Pado → ${origin} · ${runnerMode} · admin ${adminPassword ? 'enabled' : 'disabled'}`),
);
for (const context of projectSessions.values()) void warmProject(context);
async function shutdown() {
  switching = true;
  clearInterval(timer);
  await Promise.all(
    [...projectSessions.values()].map(async (context) => {
      clearTimeout(context.saveTimer);
      clearInterval(context.resourceTimer);
      await context.shells.stop();
      await context.runner.stop(true);
      clearTimeout(context.saveTimer);
      await projects.save(context.id, context.store.checkpoint());
      await context.preview?.close();
    }),
  );
  for (const s of sessions.values())
    for (const stream of [...s.streams.keys(), ...s.terminals.keys()]) stream.end();
  await vite?.close();
  server.close(() => process.exit(0));
}
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);

import { useEffect, useRef, useState, type FormEvent, type CSSProperties } from 'react';
import {
  ArrowRight,
  ArrowUp,
  Check,
  Code2,
  Compass,
  FileText,
  Globe2,
  Hand,
  LayoutDashboard,
  ListChecks,
  LoaderCircle,
  LockKeyhole,
  Maximize2,
  Minus,
  MoreHorizontal,
  Plus,
  Radio,
  Settings2,
  ShieldCheck,
  Sparkles,
  Square,
  Terminal,
  Users,
  X,
  MessageSquare,
  type LucideIcon,
} from 'lucide-react';
import { speakerLeaseSeconds, type Pane, type Snapshot } from '../../shared/protocol';
import { Markdown } from './Markdown';
import { TuiPane } from './TuiPane';
import { BrowserPane } from './BrowserPane';
import { TasksPane } from './TasksPane';
import { SubagentPane } from './SubagentPane';
import { TerminalPane } from './TerminalPane';
import { DecisionPane } from './DecisionPane';
import { SecretPane } from './SecretPane';
import { ReviewPane } from './ReviewPane';
import { ContextPane } from './ContextPane';
import { AddPaneMenu } from './AddPaneMenu';
import { SpeakerStatus } from './SpeakerStatus';
import { DemoGuide } from './DemoGuide';
import { sandboxDocument } from './sandbox';
import './App.css';

class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}
function compatibleSnapshot(snapshot: Snapshot): Snapshot {
  // Allow a frontend refresh while the previous server is draining.
  return {
    ...snapshot,
    workspace: snapshot.workspace ?? {
      activeId: 'default',
      projects: [{ id: 'default', name: '기존 프로젝트', slot: 0 }],
      switching: false,
    },
  };
}
async function api<T = { ok: boolean }>(
  path: string,
  value?: unknown,
  projectId?: string,
): Promise<T> {
  const res = await fetch(
    `/api/${path}`,
    value === undefined
      ? { headers: projectId ? { 'X-Pado-Project': projectId } : {} }
      : {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(projectId ? { 'X-Pado-Project': projectId } : {}),
          },
          body: JSON.stringify(value),
        },
  );
  const data = await res.json();
  if (!res.ok) throw new ApiError(data.error || '연결을 확인해 주세요.', res.status);
  return (data.stage ? compatibleSnapshot(data) : data) as T;
}
const icons: Record<string, LucideIcon> = {
  agent: Sparkles,
  subagent: Users,
  docs: FileText,
  context: Compass,
  tasks: ListChecks,
  terminal: Terminal,
  file: Code2,
  input: MessageSquare,
  browser: Globe2,
  review: ShieldCheck,
};
function Mark({ small = false }: { small?: boolean }) {
  return (
    <span className={`mark ${small ? 'small' : ''}`} aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

function InputFrame({
  pane,
  allowed,
  onSubmit,
  onError,
}: {
  pane: Pane;
  allowed: boolean;
  onSubmit: (values: Record<string, string>) => Promise<void>;
  onError: (message: string) => Promise<void>;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  // getRandomValues also works on private HTTP origins, unlike randomUUID.
  const [nonce] = useState(() =>
    Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join(''),
  );
  const submitted = useRef(false);
  const reported = useRef(false);
  const [error, setError] = useState('');
  const done = pane.status === 'done';
  const callback = useRef(onSubmit);
  const errorCallback = useRef(onError);
  useEffect(() => {
    callback.current = onSubmit;
    errorCallback.current = onError;
  }, [onSubmit, onError]);
  useEffect(() => {
    const receive = async (event: MessageEvent) => {
      if (
        !allowed ||
        done ||
        submitted.current ||
        event.source !== frame.current?.contentWindow ||
        event.data?.nonce !== nonce
      )
        return;
      if (event.data?.type === 'pado.input-error') {
        if (reported.current || typeof event.data.message !== 'string') return;
        reported.current = true;
        setError('입력 화면에서 오류가 발생했어요. 에이전트에게 수정을 요청했습니다.');
        try {
          await errorCallback.current(event.data.message.slice(0, 300));
        } catch {
          setError('입력 화면에서 오류가 발생했어요. 진행자에게 알려 주세요.');
        }
        return;
      }
      if (event.data?.type !== 'pado.input') return;
      const values: unknown = event.data.values;
      if (
        !values ||
        typeof values !== 'object' ||
        Array.isArray(values) ||
        Object.keys(values).length > 20 ||
        Object.entries(values).some(
          ([key, value]) => key.length > 80 || typeof value !== 'string' || value.length > 4000,
        )
      )
        return;
      submitted.current = true;
      try {
        await callback.current(values as Record<string, string>);
      } catch (e) {
        submitted.current = false;
        setError((e as Error).message);
      }
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [allowed, done, nonce]);
  const src = sandboxDocument(pane.content, nonce, !allowed || done);
  return (
    <div className="input-wrapper">
      <iframe
        ref={frame}
        title={pane.title}
        sandbox="allow-scripts allow-forms"
        referrerPolicy="no-referrer"
        srcDoc={src}
      />
      {(!allowed || done) && (
        <div className="input-cover">
          <LockKeyhole size={18} />
          <span>{done ? '답변을 전달했습니다' : '발언자의 선택을 기다리고 있어요'}</span>
        </div>
      )}
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      <div className="input-note">
        <ShieldCheck size={13} />
        <span>공개용 입력 · 비밀번호/API 키는 넣지 마세요</span>
      </div>
    </div>
  );
}
function PaneContent({
  pane,
  projectId,
  canAnswer,
  canControl,
  visible,
  readOnly,
  submit,
  now,
}: {
  pane: Pane;
  projectId: string;
  canAnswer: boolean;
  canControl: boolean;
  visible: boolean;
  readOnly: boolean;
  submit: (values: Record<string, string>) => Promise<void>;
  now: number;
}) {
  if (pane.kind === 'context') return <ContextPane pane={pane} />;
  if (pane.kind === 'review')
    return <ReviewPane pane={pane} projectId={projectId} readOnly={readOnly} />;
  if (pane.kind === 'input' && pane.secret)
    return (
      <SecretPane
        key={`${projectId}:${pane.id}:${pane.secret.name}`}
        pane={pane}
        allowed={canAnswer}
        onSubmit={(value) =>
          api('input/secret', { paneId: pane.id, value }, projectId).then(() => {})
        }
      />
    );
  if (pane.kind === 'input' && pane.decision)
    return (
      <DecisionPane
        key={`${pane.id}:${JSON.stringify(pane.decision)}`}
        pane={pane}
        allowed={canAnswer}
        onSubmit={submit}
      />
    );
  if (pane.kind === 'input')
    return (
      <InputFrame
        key={`${pane.id}:${pane.content}`}
        pane={pane}
        allowed={canAnswer}
        onSubmit={submit}
        onError={(message) =>
          api('input/error', { paneId: pane.id, message }, projectId).then(() => {})
        }
      />
    );
  if (pane.kind === 'browser')
    return (
      <BrowserPane
        key={`${pane.id}:${pane.server?.port ?? 'static'}`}
        pane={pane}
        projectId={projectId}
        readOnly={readOnly}
      />
    );
  if (pane.kind === 'tasks') return <TasksPane content={pane.content} />;
  if (pane.shell)
    return (
      <TuiPane
        shellPaneId={pane.id}
        projectId={projectId}
        canControl={canControl}
        canResize={canControl}
        visible={visible}
      />
    );
  if (pane.kind === 'terminal') return <TerminalPane pane={pane} now={now} />;
  if (pane.kind === 'file')
    return (
      <div className="file-content">
        <div className="file-label">
          <Code2 size={14} />
          {pane.title}
          <span>READ ONLY</span>
        </div>
        <pre>
          {pane.content.split('\n').map((line, i) => (
            <span className="code-line" key={i}>
              <span className="line-number">{i + 1}</span>
              <span>{line || ' '}</span>
            </span>
          ))}
        </pre>
      </div>
    );
  return (
    <div className="docs-content">
      <Markdown text={pane.content} />
    </div>
  );
}

export default function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [viewProject, setViewProject] = useState<string | null>(() =>
    sessionStorage.getItem('pado-view-project'),
  );
  const [booting, setBooting] = useState(true);
  const [connected, setConnected] = useState(false);
  const [nickname, setNickname] = useState('');
  const [prompt, setPrompt] = useState('');
  const [newProject, setNewProject] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [resizing, setResizing] = useState<{ id: string; size: number } | null>(null);
  const [narrowPanes, setNarrowPanes] = useState(() => matchMedia('(max-width: 1200px)').matches);
  const [settings, setSettings] = useState(false);
  const [password, setPassword] = useState('');
  const [mobileFocus, setMobileFocus] = useState('agent');
  const [clock, setClock] = useState(() => Date.now());
  const [offset, setOffset] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(
    () => localStorage.getItem('pado-reduce-motion') === 'true',
  );
  const dialog = useRef<HTMLDialogElement>(null);
  const conversationEnd = useRef<HTMLDivElement>(null);
  const paneGrid = useRef<HTMLDivElement>(null);
  const mobileTabs = useRef<HTMLElement>(null);
  const focusRef = useRef(-1);
  const projectRef = useRef('');
  const meId = snapshot?.me.id;
  useEffect(() => {
    const query = matchMedia('(max-width: 1200px)');
    const change = () => setNarrowPanes(query.matches);
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    void api<Snapshot>('me')
      .then(setSnapshot)
      .catch(() => {})
      .finally(() => setBooting(false));
  }, []);
  useEffect(() => {
    if (!meId) return;
    let disposed = false;
    const events = new EventSource(
      `/api/events${viewProject ? `?project=${encodeURIComponent(viewProject)}` : ''}`,
    );
    events.addEventListener('state', (event) => {
      if (disposed) return;
      const next = compatibleSnapshot(JSON.parse((event as MessageEvent).data));
      const nextProject = next.workspace.viewedId ?? next.workspace.activeId;
      if (nextProject !== projectRef.current) {
        projectRef.current = nextProject;
        setPrompt('');
        setResizing(null);
        setMobileFocus(next.stage.focusId);
      }
      setSnapshot(next);
      setConnected(true);
      setOffset(next.stage.serverTime - Date.now());
      if (next.stage.focusVersion !== focusRef.current) {
        focusRef.current = next.stage.focusVersion;
        setMobileFocus(next.stage.focusId);
      }
    });
    let checking = false;
    events.onerror = async () => {
      if (disposed) return;
      setConnected(false);
      if (checking) return;
      checking = true;
      try {
        await api<Snapshot>(
          `me${viewProject ? `?project=${encodeURIComponent(viewProject)}` : ''}`,
        );
      } catch (error) {
        if (
          !disposed &&
          error instanceof ApiError &&
          (error.status === 404 || error.status === 400)
        ) {
          setViewProject(null);
          setError('열람할 프로젝트가 없어 참여 프로젝트로 돌아갑니다.');
        }
        if (!disposed && error instanceof ApiError && error.status === 401) {
          events.close();
          setSnapshot(null);
          setPassword('');
          setSettings(false);
          setMobileFocus('agent');
          focusRef.current = -1;
          setError('세션이 종료되었어요. 닉네임으로 다시 입장해 주세요.');
        }
      } finally {
        checking = false;
      }
    };
    return () => {
      disposed = true;
      events.close();
    };
  }, [meId, viewProject]);
  useEffect(() => {
    if (viewProject) sessionStorage.setItem('pado-view-project', viewProject);
    else sessionStorage.removeItem('pado-view-project');
  }, [viewProject]);
  useEffect(() => {
    const interval = setInterval(() => setClock(Date.now()), 500);
    return () => clearInterval(interval);
  }, []);
  useEffect(() => {
    if (settings) dialog.current?.showModal();
    else dialog.current?.close();
  }, [settings]);
  useEffect(() => {
    document.documentElement.dataset.reduceMotion = String(reduceMotion);
    localStorage.setItem('pado-reduce-motion', String(reduceMotion));
  }, [reduceMotion]);
  useEffect(() => {
    conversationEnd.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [snapshot?.stage.messages.length]);
  useEffect(() => {
    const grid = paneGrid.current;
    const id = snapshot?.stage.focusId;
    if (!grid || !id || matchMedia('(max-width: 600px)').matches) return;
    const frame = requestAnimationFrame(() => {
      const pane = [...grid.children].find(
        (node) => (node as HTMLElement).dataset.paneId === id,
      ) as HTMLElement | undefined;
      if (!pane) return;
      const top = pane.offsetTop;
      if (top < grid.scrollTop || top + pane.offsetHeight > grid.scrollTop + grid.clientHeight)
        grid.scrollTo({ top, behavior: reduceMotion ? 'instant' : 'smooth' });
    });
    return () => cancelAnimationFrame(frame);
  }, [snapshot?.stage.focusId, snapshot?.stage.focusVersion, reduceMotion]);
  useEffect(() => {
    const tabs = mobileTabs.current;
    if (!tabs || !matchMedia('(max-width: 600px)').matches) return;
    const active = tabs.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!active) return;
    const bounds = tabs.getBoundingClientRect();
    const item = active.getBoundingClientRect();
    if (item.left < bounds.left || item.right > bounds.right)
      tabs.scrollBy({
        left: item.left - bounds.left,
        behavior: reduceMotion ? 'instant' : 'smooth',
      });
  }, [mobileFocus, snapshot?.stage.focusVersion, reduceMotion]);
  useEffect(() => {
    if (error) {
      const timeout = setTimeout(() => setError(''), 6500);
      return () => clearTimeout(timeout);
    }
  }, [error]);
  const perform = async (fn: () => Promise<unknown>) => {
    setPending(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  };
  const join = (e: FormEvent) => {
    e.preventDefault();
    void perform(async () => setSnapshot(await api<Snapshot>('join', { nickname })));
  };
  if (booting)
    return (
      <div className="loading-screen">
        <Mark />
        <LoaderCircle className="spin" size={20} />
        <span>Stage에 연결하고 있어요</span>
      </div>
    );
  if (!snapshot)
    return (
      <main className="entry">
        <div className="entry-story">
          <a className="brand" href="/">
            <Mark />
            <strong>pado</strong>
          </a>
          <div className="entry-copy">
            <div className="eyebrow">
              <span className="dot blue" />
              프로젝트 소개
            </div>
            <h1>
              AI가 코딩하고,
              <br />
              <span>필요한 화면도 만듭니다.</span>
            </h1>
            <p>
              선택할 땐 입력창, 완성되면 실행 화면.
              <br />
              작업에 맞춰 달라지는 AI 개발 환경, Pado.
            </p>
          </div>
        </div>
        <section className="entry-demo" aria-labelledby="entry-demo-title">
          <h2 id="entry-demo-title">데모 체험 방법</h2>
          <p>
            입장 후 <strong>‘손들고 참여하기’</strong>로 작업을 요청해 보세요.
            <br />
            AI가 필요한 화면을 꺼내는 과정을 볼 수 있어요.
          </p>
          <div className="entry-foot">
            PADO / GENERATIVE WORKSPACE<span>BYPP HACKATHON 2026</span>
          </div>
        </section>
        <section className="entry-form" aria-labelledby="entry-form-title">
          <div className="entry-form-inner">
            <span className="stage-label">
              <Radio size={14} aria-hidden="true" />
              데모 입장
            </span>
            <h2 id="entry-form-title">
              닉네임을 입력하고
              <br />
              바로 입장하세요.
            </h2>
            <p>회원가입 없이 바로 체험할 수 있어요.</p>
            <form onSubmit={join}>
              <label htmlFor="nickname">어떻게 불러 드릴까요?</label>
              <input
                id="nickname"
                autoComplete="nickname"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                maxLength={24}
                placeholder="닉네임을 입력해 주세요"
                autoFocus={matchMedia('(min-width: 851px)').matches}
                required
              />
              <button className="primary enter-button" disabled={pending || !nickname.trim()}>
                {pending ? (
                  <LoaderCircle className="spin" size={18} />
                ) : (
                  <>
                    Stage 입장하기
                    <ArrowRight size={18} />
                  </>
                )}
              </button>
            </form>
            {error && (
              <p className="inline-error" role="alert">
                {error}
              </p>
            )}
          </div>
        </section>
      </main>
    );

  const { stage, me } = snapshot;
  const participantTui = snapshot.participantTui ?? !snapshot.publicMode;
  const projectId = snapshot.workspace.viewedId ?? snapshot.workspace.activeId;
  const isParticipatingProject = projectId === snapshot.workspace.activeId;
  const canInteract = isParticipatingProject && connected && !snapshot.workspace.switching;
  const designatedProject = snapshot.workspace.projects.find(
    (project) => project.id === snapshot.workspace.activeId,
  )!;
  const activeProject = snapshot.workspace.projects.find((project) => project.id === projectId)!;
  const projectBusy = !connected || pending || snapshot.workspace.switching;
  const designationBusy =
    projectBusy || (snapshot.workspace.activeBusy ?? (!!stage.turn || !!stage.speaker));
  const projectNotice = !connected
    ? '다시 연결되면 전환할 수 있어요'
    : snapshot.workspace.switching
      ? '프로젝트를 전환하고 있어요…'
      : '둘러보기는 내 화면에만 반영됩니다';
  const selectProject = (id: string) => {
    if (id !== projectId) {
      setConnected(false);
      setViewProject(id);
    }
  };
  const action = <T = { ok: boolean },>(path: string, value?: unknown) =>
    api<T>(path, value, projectId);
  const online = stage.participants.filter((p) => p.online);
  const isSpeaker = isParticipatingProject && stage.speaker?.participantId === me.id;
  const seconds = stage.speaker
    ? Math.max(
        0,
        Math.min(speakerLeaseSeconds, Math.ceil((stage.speaker.expiresAt - clock - offset) / 1000)),
      )
    : 0;
  const busy = !!stage.turn;
  const canRaise = canInteract && !pending && !busy && !stage.speaker;
  const canManagePanes =
    canInteract &&
    (me.admin || (stage.turn?.participantId ?? stage.speaker?.participantId) === me.id);
  const participation = canRaise ? (
    <div className="participation-overlay">
      <button
        className="raise-button"
        title={`${speakerLeaseSeconds}초 동안 아이디어를 직접 입력할 수 있어요`}
        onClick={() => void perform(() => action('raise', {}))}
      >
        <Hand size={19} aria-hidden="true" />
        손들고 참여하기
        <ArrowRight size={16} aria-hidden="true" />
      </button>
    </div>
  ) : null;
  const stackedPanes = stage.runner === 'antigravity' || narrowPanes || stage.panes.length > 3;
  const activityLabels = {
    planning: '작업 방향을 정리하고 있어요',
    reading: '프로젝트를 확인하고 있어요',
    writing: '코드를 작성하고 있어요',
    running: '명령을 실행하고 있어요',
    delegating: '작업을 나누고 있어요',
    reviewing: '결과를 정리하고 있어요',
  };
  const phase =
    stage.phase === 'running'
      ? '작업 중'
      : stage.phase === 'waiting'
        ? '입력 대기'
        : stage.phase === 'error'
          ? '확인 필요'
          : '다음 아이디어 대기 중';
  const activeFocus =
    mobileFocus === 'agent' || stage.panes.some((p) => p.id === mobileFocus)
      ? mobileFocus
      : 'agent';
  const present = (event: unknown) => action('panes/present', event);
  const submitPrompt = (e: FormEvent) => {
    e.preventDefault();
    void perform(async () => {
      await action('prompt', { prompt });
      setPrompt('');
    });
  };
  const resize = (pane: Pane, amount: number) =>
    perform(() =>
      present({
        type: 'pane.resize',
        id: pane.id,
        size: Math.max(1, Math.min(3, pane.size + amount)),
      }),
    );
  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Pado 홈">
          <Mark small />
          <strong>pado</strong>
        </a>
        <div className="workspace-heading">
          <h1 className="workspace-name" title={activeProject.name}>
            {activeProject.name}
          </h1>
          <SpeakerStatus snapshot={snapshot} connected={connected} />
        </div>
        <div className="topbar-right">
          <span className={`connection ${connected ? '' : 'offline'}`}>
            <span className="dot" />
            {connected ? '연결됨' : '재연결 중'}
          </span>
          <span className="avatar-stack">
            {online.slice(0, 3).map((p, i) => (
              <i key={p.id} style={{ '--avatar-hue': `${210 + i * 45}` } as CSSProperties}>
                {p.nickname.slice(0, 1)}
              </i>
            ))}
          </span>
          <span className="online-count">
            <Users size={15} />
            {online.length}
          </span>
          <AddPaneMenu
            key={projectId}
            projectId={projectId}
            canManage={canManagePanes}
            live={stage.runner === 'antigravity'}
            count={stage.panes.filter((pane) => pane.kind !== 'subagent').length}
            add={(request) => action('panes/add', request)}
          />
          <button
            className="icon-button settings-button"
            aria-label="설정"
            onClick={() => setSettings(true)}
          >
            <Settings2 size={19} />
          </button>
        </div>
      </header>
      <aside className="sidebar">
        <div className="sidebar-label">PROJECTS</div>
        <nav className="project-nav" aria-label="프로젝트 목록" aria-describedby="project-notice">
          {snapshot.workspace.projects.map((project) => (
            <button
              key={project.id}
              className={`nav-item ${project.id === projectId ? 'selected' : ''}`}
              aria-current={project.id === projectId ? 'page' : undefined}
              title={project.name}
              disabled={!connected}
              onClick={() => selectProject(project.id)}
            >
              <LayoutDashboard size={17} aria-hidden="true" />
              <span className="project-name">{project.name}</span>
              {project.id === snapshot.workspace.activeId && (
                <span className="project-live-mark" aria-hidden="true">
                  참여
                </span>
              )}
            </button>
          ))}
        </nav>
        {me.admin && (
          <button
            className="sidebar-create"
            disabled={projectBusy}
            aria-expanded={newProject}
            aria-controls={newProject ? 'project-create' : undefined}
            onClick={() => setNewProject(!newProject)}
          >
            <Plus size={15} /> 새 프로젝트
          </button>
        )}
        <p id="project-notice" className="sidebar-project-notice" role="status">
          {projectNotice}
        </p>
        <div className="sidebar-session">
          <span className="sidebar-label">THIS SESSION</span>
          <div className="session-line">
            <span className="dot blue" />
            {phase}
          </div>
          <p>
            {stage.runner === 'rehearsal' ? '로컬 리허설' : 'Antigravity CLI'}
            <br />
            하나의 공간에서 함께 만듭니다.
          </p>
        </div>
        <div className="sidebar-bottom">
          <div className="little-note">
            <Sparkles size={18} />
            <p>
              필요한 순간에,
              <br />
              필요한 화면만.
            </p>
          </div>
          <button className="profile" onClick={() => setSettings(true)}>
            <span className="avatar">{me.nickname.slice(0, 1)}</span>
            <span>
              <strong>{me.nickname}</strong>
              <small>{me.admin ? 'Administrator' : 'Stage participant'}</small>
            </span>
            <MoreHorizontal size={17} />
          </button>
        </div>
      </aside>
      <main className="stage-main">
        <div className="project-bar">
          <label htmlFor="project-select">프로젝트</label>
          <select
            id="project-select"
            value={projectId}
            disabled={!connected}
            onChange={(event) => selectProject(event.target.value)}
          >
            {snapshot.workspace.projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          {me.admin && (
            <button
              disabled={projectBusy}
              aria-expanded={newProject}
              aria-controls={newProject ? 'project-create' : undefined}
              onClick={() => setNewProject(!newProject)}
            >
              <Plus size={14} /> 새 프로젝트
            </button>
          )}
          <small role="status">{projectNotice}</small>
        </div>
        {newProject && me.admin && (
          <form
            id="project-create"
            className="project-create"
            onSubmit={(event) => {
              event.preventDefault();
              void perform(async () => {
                const created = await api<Snapshot>('admin/projects', { name: projectName });
                const project = created.workspace.projects.find(
                  (item) => item.name === projectName.trim(),
                )!;
                setNewProject(false);
                setProjectName('');
                selectProject(project.id);
              });
            }}
          >
            <input
              aria-label="새 프로젝트 이름"
              value={projectName}
              onChange={(event) => setProjectName(event.target.value)}
              maxLength={40}
              placeholder="프로젝트 이름"
              required
              autoFocus
            />
            <button className="primary" disabled={projectBusy || !projectName.trim()}>
              만들고 열기
            </button>
            <button type="button" onClick={() => setNewProject(false)}>
              취소
            </button>
            <small>빈 workspace에서 시작합니다. 기존 프로젝트의 파일은 옮기지 않습니다.</small>
          </form>
        )}
        {!isParticipatingProject && (
          <div className="project-reading-bar" role="status">
            <span>
              <LockKeyhole size={13} /> 읽기 전용 <small>참여: {designatedProject.name}</small>
            </span>
            <button
              onClick={() => {
                setConnected(false);
                setViewProject(null);
              }}
            >
              참여 프로젝트로 돌아가기
            </button>
            {me.admin && (
              <button
                disabled={designationBusy}
                title={designationBusy ? '현재 작업과 발언권이 끝나면 지정할 수 있어요' : undefined}
                onClick={() => void perform(() => api('admin/projects/select', { id: projectId }))}
              >
                참여 프로젝트로 지정
              </button>
            )}
          </div>
        )}
        {me.admin && isParticipatingProject && (
          <div className="admin-toolbar">
            <span>
              <ShieldCheck size={14} />
              Stage controls
            </span>
            <button
              onClick={() => void perform(() => action('admin/revoke', {}))}
              disabled={!stage.speaker || pending}
            >
              발언권 회수
            </button>
            <button
              onClick={() => void perform(() => action('admin/stop', {}))}
              disabled={!busy || pending}
            >
              <Square size={12} />
              작업 중단
            </button>
            <button
              onClick={() =>
                void perform(() =>
                  action('admin/present', {
                    type: 'pane.upsert',
                    pane: {
                      id: 'stage-note',
                      kind: 'docs',
                      title: 'Stage 안내',
                      content: `# 함께 만드는 공간\n\n손을 들고 아이디어를 남겨 주세요.\n발언 시간은 ${speakerLeaseSeconds}초입니다.`,
                    },
                  }),
                )
              }
            >
              안내 열기
            </button>
            <button
              onClick={() => {
                if (window.confirm('현재 작업을 중단하고 pane과 대화를 초기화할까요?'))
                  void perform(() => action('admin/reset', {}));
              }}
            >
              초기화
            </button>
          </div>
        )}
        <nav ref={mobileTabs} className="mobile-tabs" aria-label="Workspace pane 전환">
          {[{ id: 'agent', kind: 'agent', title: 'Agent' }, ...stage.panes].map((p) => {
            const Icon = icons[p.kind];
            return (
              <button
                key={p.id}
                className={activeFocus === p.id ? 'active' : ''}
                aria-pressed={activeFocus === p.id}
                onClick={() => setMobileFocus(p.id)}
              >
                <Icon size={15} />
                {p.title}
              </button>
            );
          })}
        </nav>
        <div
          key={projectId}
          className={`workspace ${stage.panes.length ? 'has-panes' : ''} ${stage.runner === 'antigravity' ? 'native-workspace' : ''}`}
          data-focus-kind={stage.panes.find((pane) => pane.id === stage.focusId)?.kind || 'agent'}
        >
          <section
            className={`pane agent-pane ${activeFocus === 'agent' ? 'mobile-active' : ''}`}
            aria-label="Agent pane"
          >
            <div className="pane-header">
              <div className="pane-heading">
                <span className="pane-icon agent-icon">
                  <Sparkles size={16} />
                </span>
                <strong>{stage.runner === 'antigravity' ? 'Antigravity' : 'Agent'}</strong>
              </div>
              <span className="agent-activity" role="status" aria-label={phase} title={phase}>
                {busy ? (
                  <LoaderCircle size={14} className="spin" />
                ) : (
                  <span className="dot green" />
                )}
              </span>
            </div>
            {stage.runner === 'antigravity' ? (
              <TuiPane
                projectId={projectId}
                canResize={canInteract && (isSpeaker || stage.turn?.participantId === me.id)}
                canControl={
                  canInteract &&
                  (me.admin ||
                    (participantTui && (isSpeaker || stage.turn?.participantId === me.id)))
                }
                visible={activeFocus === 'agent'}
                participation={participation}
              />
            ) : (
              <div className="conversation-surface">
                <div className="conversation">
                  <div className="conversation-date">지금, 함께 만드는 중</div>
                  {stage.messages.map((message) => (
                    <article key={message.id} className={`message ${message.author}`}>
                      <div className="message-avatar">
                        {message.author === 'agent' ? (
                          <Mark small />
                        ) : (
                          <span>{message.nickname?.slice(0, 1) || '•'}</span>
                        )}
                      </div>
                      <div>
                        <div className="message-meta">
                          <b>
                            {message.author === 'agent'
                              ? 'Pado'
                              : message.author === 'system'
                                ? 'Stage'
                                : message.nickname}
                          </b>
                          <time>
                            {new Date(message.at).toLocaleTimeString('ko-KR', {
                              hour: '2-digit',
                              minute: '2-digit',
                              hour12: false,
                            })}
                          </time>
                        </div>
                        {message.author === 'agent' ? (
                          <Markdown text={message.text} />
                        ) : (
                          <p>{message.text}</p>
                        )}
                      </div>
                    </article>
                  ))}
                  {busy && (
                    <div className="thinking">
                      <span />
                      <span />
                      <span />
                      <p>
                        {stage.phase === 'waiting'
                          ? '선택을 기다리고 있어요'
                          : stage.activity
                            ? activityLabels[stage.activity.phase]
                            : '작업을 이어 가고 있어요'}
                      </p>
                    </div>
                  )}
                  <div ref={conversationEnd} />
                </div>
                {participation}
              </div>
            )}
            {isSpeaker && (
              <div
                className={
                  stage.runner === 'antigravity' && participantTui
                    ? 'native-speaker-controls'
                    : 'composer'
                }
              >
                <div className="speaker-status" role="status">
                  <span className="dot blue" />
                  <b>지금은 내 차례</b>
                  <span className="countdown">{seconds}초</span>
                </div>
                {stage.runner === 'antigravity' && participantTui ? (
                  <button
                    className="text-button"
                    disabled={pending || !connected}
                    onClick={() => void perform(() => action('release', {}))}
                  >
                    다음 분께 양보
                  </button>
                ) : (
                  <form onSubmit={submitPrompt}>
                    <label className="sr-only" htmlFor="prompt">
                      아이디어
                    </label>
                    <textarea
                      id="prompt"
                      placeholder="어떤 것을 만들어 볼까요?"
                      maxLength={4000}
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      autoFocus
                      rows={3}
                    />
                    <div className="composer-footer">
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => void perform(() => action('release', {}))}
                      >
                        다음 분께 양보
                      </button>
                      <button
                        className="send-button"
                        aria-label="프롬프트 보내기"
                        disabled={pending || !connected || !prompt.trim()}
                      >
                        <ArrowUp size={18} />
                      </button>
                    </div>
                  </form>
                )}
              </div>
            )}
          </section>
          {!stage.panes.length ? (
            stage.runner === 'antigravity' ? null : (
              <section className="workspace-empty">
                <div className="empty-shapes" aria-hidden="true">
                  <div>
                    <FileText size={17} />
                    <span />
                    <span />
                  </div>
                  <div>
                    <Terminal size={17} />
                    <span />
                    <span />
                  </div>
                  <div>
                    <Sparkles size={19} />
                    <span />
                  </div>
                </div>
                <span className="eyebrow">ROOM FOR YOUR NEXT IDEA</span>
                <h2>아직은 비어 있는, 무한한 가능성.</h2>
                <p>
                  에이전트가 작업에 필요한 화면을 여기에 펼쳐 놓을 거예요.
                  <br />
                  지금은 아이디어 하나면 충분합니다.
                </p>
                <div className="pane-types">
                  <span>
                    <Terminal size={14} />
                    Terminal
                  </span>
                  <span>
                    <FileText size={14} />
                    Docs
                  </span>
                  <span>
                    <ListChecks size={14} />
                    Tasks
                  </span>
                  <span>
                    <Code2 size={14} />
                    File
                  </span>
                  <span>
                    <MessageSquare size={14} />
                    Input
                  </span>
                </div>
                <div className="empty-bottom">
                  <span className="dot blue" />
                  Workspace adapts. You stay in flow.
                </div>
              </section>
            )
          ) : (
            <div
              ref={paneGrid}
              className={`pane-grid ${stage.panes.length > 3 ? 'many-panes' : ''}`}
            >
              {stage.panes.map((pane) => {
                const Icon = icons[pane.kind];
                const displaySize = resizing?.id === pane.id ? resizing.size : pane.size;
                return (
                  <section
                    key={pane.id}
                    data-pane-id={pane.id}
                    className={`pane content-pane ${pane.kind}-pane ${activeFocus === pane.id ? 'mobile-active' : ''} ${stage.focusId === pane.id ? 'focused' : ''} ${resizing?.id === pane.id ? 'resizing' : ''}`}
                    style={{
                      flexGrow: displaySize,
                      ...(stage.panes.length > 3 ? { flexBasis: 160 * displaySize } : {}),
                    }}
                    aria-label={`${pane.title} pane`}
                  >
                    <div className="pane-header">
                      <div className="pane-heading">
                        <span className={`pane-icon ${pane.kind}-icon`}>
                          <Icon size={16} />
                        </span>
                        <strong>{pane.title}</strong>
                      </div>
                      <div className="pane-tools">
                        {pane.status === 'done' &&
                          pane.kind !== 'review' &&
                          pane.kind !== 'context' &&
                          (pane.kind !== 'subagent' || pane.subagent?.state === 'idle') && (
                            <Check className="success" size={15} />
                          )}
                        {canManagePanes ? (
                          <>
                            <button
                              className="icon-button"
                              aria-label={`${pane.title} 축소`}
                              onClick={() => void resize(pane, -0.5)}
                            >
                              <Minus size={13} />
                            </button>
                            <button
                              className="icon-button"
                              aria-label={`${pane.title} 확대`}
                              onClick={() => void resize(pane, 0.5)}
                            >
                              <Plus size={13} />
                            </button>
                            <button
                              className="icon-button"
                              aria-label={`${pane.title} 전체에 포커스`}
                              onClick={() =>
                                void perform(() => present({ type: 'pane.focus', id: pane.id }))
                              }
                            >
                              <Maximize2 size={13} />
                            </button>
                            <button
                              className="icon-button"
                              aria-label={`${pane.title} 닫기`}
                              onClick={() =>
                                void perform(() => present({ type: 'pane.close', id: pane.id }))
                              }
                            >
                              <X size={14} />
                            </button>
                          </>
                        ) : null}
                      </div>
                    </div>
                    {pane.kind === 'subagent' ? (
                      <SubagentPane
                        pane={pane}
                        now={clock + offset}
                        serverOffset={offset}
                        reduceMotion={reduceMotion}
                      />
                    ) : (
                      <>
                        <PaneContent
                          now={clock + offset}
                          projectId={projectId}
                          pane={pane}
                          canControl={canManagePanes}
                          visible={
                            !matchMedia('(max-width: 600px)').matches || activeFocus === pane.id
                          }
                          canAnswer={
                            canInteract && (me.admin || stage.turn?.participantId === me.id)
                          }
                          readOnly={!isParticipatingProject}
                          submit={(values) =>
                            action('input', { paneId: pane.id, values }).then(() => {})
                          }
                        />
                      </>
                    )}
                    {canManagePanes && (
                      <div
                        className={`resize-handle ${stackedPanes ? 'horizontal' : ''}`}
                        role="separator"
                        tabIndex={0}
                        aria-label={`${pane.title} 크기 조절`}
                        aria-orientation={stackedPanes ? 'horizontal' : 'vertical'}
                        aria-valuemin={1}
                        aria-valuemax={3}
                        aria-valuenow={displaySize}
                        onKeyDown={(e) => {
                          if (['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
                            e.preventDefault();
                            void resize(
                              pane,
                              e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 0.25 : -0.25,
                            );
                          }
                        }}
                        onPointerDown={(e) => {
                          if (e.button !== 0 || pending) return;
                          e.preventDefault();
                          const coordinate = (event: { clientX: number; clientY: number }) =>
                            stackedPanes ? event.clientY : event.clientX;
                          const start = coordinate(e);
                          const element = e.currentTarget;
                          element.setPointerCapture(e.pointerId);
                          const sizeAt = (event: { clientX: number; clientY: number }) =>
                            Math.round(
                              Math.max(
                                1,
                                Math.min(3, pane.size + (coordinate(event) - start) / 180),
                              ) * 100,
                            ) / 100;
                          setResizing({ id: pane.id, size: pane.size });
                          element.onpointermove = (move) =>
                            setResizing({ id: pane.id, size: sizeAt(move) });
                          const clear = () => {
                            element.onpointermove = null;
                            element.onpointerup = null;
                            element.onpointercancel = null;
                          };
                          element.onpointerup = (finish) => {
                            element.releasePointerCapture(finish.pointerId);
                            clear();
                            void perform(() =>
                              present({ type: 'pane.resize', id: pane.id, size: sizeAt(finish) }),
                            ).finally(() => setResizing(null));
                          };
                          element.onpointercancel = () => {
                            clear();
                            setResizing(null);
                          };
                        }}
                      />
                    )}
                  </section>
                );
              })}
            </div>
          )}
        </div>
      </main>
      <DemoGuide snapshot={snapshot} connected={connected} />
      {error && (
        <div className="toast" role="alert">
          {error}
          <button aria-label="알림 닫기" onClick={() => setError('')}>
            <X size={16} />
          </button>
        </div>
      )}
      <dialog
        ref={dialog}
        className="settings-dialog"
        onCancel={() => setSettings(false)}
        onClose={() => setSettings(false)}
        aria-labelledby="settings-title"
      >
        <div className="dialog-heading">
          <h2 id="settings-title">Workspace 설정</h2>
          <button className="icon-button" aria-label="설정 닫기" onClick={() => setSettings(false)}>
            <X size={20} />
          </button>
        </div>
        <div className="settings-row">
          <div>
            <strong>모션 줄이기</strong>
            <p>화면 전환과 pane 애니메이션을 줄입니다.</p>
          </div>
          <input
            type="checkbox"
            aria-label="모션 줄이기"
            checked={reduceMotion}
            onChange={(e) => setReduceMotion(e.target.checked)}
          />
        </div>
        <div className="settings-row">
          <div>
            <strong>현재 실행 모드</strong>
            <p>
              {stage.runner === 'rehearsal'
                ? '리허설 · 고정 시나리오와 실제 프로세스 출력'
                : 'Antigravity · 격리된 Docker 작업 환경'}
            </p>
          </div>
        </div>
        <section className="admin-login">
          <span className="eyebrow">
            <ShieldCheck size={14} />
            ADMIN MODE
          </span>
          <h3>{me.admin ? '관리자 모드가 켜져 있어요' : 'Stage 진행을 직접 제어하세요'}</h3>
          <p>pane 조작, 발언권 회수, 작업 중단과 초기화.</p>
          {me.admin ? (
            <button
              className="secondary"
              onClick={() => void perform(() => api('admin/logout', {}))}
            >
              관리자 모드 종료
            </button>
          ) : snapshot.adminAvailable ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void perform(async () => {
                  setSnapshot(await api<Snapshot>('admin/login', { password }));
                  setPassword('');
                  setSettings(false);
                });
              }}
            >
              <label htmlFor="admin-password">관리자 비밀번호</label>
              <input
                id="admin-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
              <button className="primary" disabled={pending}>
                관리자 모드 시작
                <ArrowRight size={16} />
              </button>
            </form>
          ) : (
            <p className="settings-note">관리자 인증이 아직 설정되지 않았습니다.</p>
          )}
        </section>
      </dialog>
    </div>
  );
}

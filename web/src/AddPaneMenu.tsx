import { useEffect, useRef, useState } from 'react';
import { Code2, FileText, Globe2, ListChecks, Plus, Terminal, X } from 'lucide-react';
import { previewPorts, type AddPaneRequest, type PaneCatalogItem } from '../../shared/protocol';

export function AddPaneMenu({
  projectId,
  canManage,
  live,
  count,
  add,
}: {
  projectId: string;
  canManage: boolean;
  live: boolean;
  count: number;
  add: (request: AddPaneRequest) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [browser, setBrowser] = useState(false);
  const [port, setPort] = useState<(typeof previewPorts)[number]>(3000);
  const [path, setPath] = useState('/');
  const [panes, setPanes] = useState<PaneCatalogItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const host = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    panel.current?.focus();
    const controller = new AbortController();
    void fetch(`/api/panes?project=${encodeURIComponent(projectId)}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('저장된 pane 목록을 불러오지 못했습니다.');
        setPanes((await response.json()).panes);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    const outside = (event: PointerEvent) => {
      if (!host.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      controller.abort();
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open, projectId]);
  const submit = async (request: AddPaneRequest) => {
    setPending(true);
    setError('');
    try {
      await add(request);
      setOpen(false);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setPending(false);
    }
  };
  const disabled = !canManage || pending;
  const full = count >= 6;
  return (
    <div className="add-pane" ref={host}>
      <button
        ref={trigger}
        className="icon-button add-pane-button"
        aria-label="pane 추가"
        title="pane 추가"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? 'add-pane-menu' : undefined}
        onClick={() => {
          if (!open) {
            setLoading(true);
            setError('');
          }
          setOpen(!open);
          setBrowser(false);
        }}
      >
        <Plus size={19} />
      </button>
      {open && (
        <div
          id="add-pane-menu"
          className="add-pane-menu"
          role="dialog"
          aria-label="pane 추가 메뉴"
          tabIndex={-1}
          ref={panel}
        >
          <div className="add-pane-heading">
            <strong>Pane 추가</strong>
            <button
              className="icon-button"
              aria-label="pane 추가 메뉴 닫기"
              onClick={() => {
                setOpen(false);
                trigger.current?.focus();
              }}
            >
              <X size={15} />
            </button>
          </div>
          <button
            className="add-pane-option"
            disabled={disabled || full || !live}
            onClick={() => void submit({ kind: 'terminal' })}
          >
            <Terminal size={18} />
            <span>
              <b>Terminal</b>
              <small>명령을 직접 입력하는 프로젝트 터미널</small>
            </span>
          </button>
          <button
            className="add-pane-option"
            disabled={disabled || full || !live}
            aria-expanded={browser}
            onClick={() => setBrowser(!browser)}
          >
            <Globe2 size={18} />
            <span>
              <b>Browser</b>
              <small>실행 중인 앱 미리보기</small>
            </span>
          </button>
          {browser && (
            <form
              className="add-browser-form"
              onSubmit={(event) => {
                event.preventDefault();
                void submit({ kind: 'browser', server: { port, path } });
              }}
            >
              <label>
                앱 포트
                <select
                  value={port}
                  onChange={(event) => setPort(Number(event.target.value) as typeof port)}
                >
                  {previewPorts.map((port) => (
                    <option key={port} value={port}>
                      {port}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                경로
                <input
                  value={path}
                  onChange={(event) => setPath(event.target.value)}
                  placeholder="/"
                  maxLength={500}
                  required
                />
              </label>
              <button className="primary" disabled={disabled || full}>
                Browser 추가
              </button>
            </form>
          )}
          {!canManage && (
            <p className="add-pane-note">참여 프로젝트의 발언자 또는 관리자가 추가할 수 있어요.</p>
          )}
          {!live && (
            <p className="add-pane-note">
              터미널과 앱 미리보기는 실제 실행 모드에서 사용할 수 있어요.
            </p>
          )}
          {full && (
            <p className="add-pane-note">최대 6개까지 열 수 있어요. pane 하나를 닫아 주세요.</p>
          )}
          <div className="add-pane-saved">
            <span>공유된 pane 다시 열기</span>
            {loading ? (
              <p>목록을 불러오는 중…</p>
            ) : panes.length ? (
              panes.map((pane) => {
                const Icon =
                  pane.kind === 'file'
                    ? Code2
                    : pane.kind === 'tasks'
                      ? ListChecks
                      : pane.kind === 'terminal'
                        ? Terminal
                        : pane.kind === 'browser'
                          ? Globe2
                          : FileText;
                return (
                  <button
                    key={pane.id}
                    className="add-pane-option"
                    disabled={disabled || (full && !pane.visible)}
                    onClick={() => void submit({ kind: 'saved', id: pane.id })}
                  >
                    <Icon size={16} />
                    <span>
                      <b>{pane.title}</b>
                      <small>
                        {pane.kind} · {pane.visible ? '열려 있음' : '다시 열기'}
                      </small>
                    </span>
                  </button>
                );
              })
            ) : (
              <p>에이전트가 공유한 Docs, File, Tasks 등이 여기에 모여요.</p>
            )}
          </div>
          {pending && (
            <p className="add-pane-note" role="status">
              pane을 열고 있어요…
            </p>
          )}
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

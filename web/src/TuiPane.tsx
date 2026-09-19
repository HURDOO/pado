import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import type { TuiFrame, TuiStatus } from '../../shared/protocol';
import { withTerminalModifiers, type TerminalModifiers } from './terminal-keys';
import '@xterm/xterm/css/xterm.css';

async function send(path: string, value: unknown, projectId: string, base = 'tui') {
  const response = await fetch(`/api/${base}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Pado-Project': projectId },
    body: JSON.stringify(value),
  });
  if (!response.ok) throw new Error((await response.json()).error || 'TUI 연결을 확인해 주세요.');
}
// Native protocol queries are answered by the single server-side terminal emulator.
// Browser emulators must not each send duplicate device/cursor replies to the PTY.
// eslint-disable-next-line no-control-regex -- VT replies contain ESC by design.
const protocolReply = /^\x1b(?:\[\??[\d;]*(?:c|n|R)|\][\s\S]*|\[[IO])$/;
const statusLabels: Record<TuiStatus, string> = {
  starting: 'TUI 시작 중',
  ready: '실제 Antigravity 세션',
  stopped: '세션 종료 · 손들면 새로 시작',
  error: '연결 오류 · 다시 시작해 주세요',
};

export function TuiPane({
  canControl,
  canResize,
  visible,
  projectId,
  participation,
  shellPaneId,
}: {
  canControl: boolean;
  canResize: boolean;
  visible: boolean;
  projectId: string;
  participation?: ReactNode;
  shellPaneId?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const controller = useRef(false);
  const sizeController = useRef(false);
  const transport = useRef<(data: string) => void>(() => {});
  const discard = useRef<() => void>(() => {});
  const resize = useRef<() => void>(() => {});
  const [status, setStatus] = useState<TuiStatus>('starting');
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  const modifierState = useRef<TerminalModifiers>({ ctrl: false, alt: false });
  const [modifiers, setModifiers] = useState<TerminalModifiers>({ ctrl: false, alt: false });
  const clearModifiers = useCallback(() => {
    modifierState.current = { ctrl: false, alt: false };
    setModifiers(modifierState.current);
  }, []);
  const toggleModifier = (key: keyof TerminalModifiers) => {
    if (!controller.current) return;
    modifierState.current = { ...modifierState.current, [key]: !modifierState.current[key] };
    setModifiers(modifierState.current);
    terminal.current?.focus();
  };

  useEffect(() => {
    controller.current = canControl;
    sizeController.current = canResize;
    if (!canControl) discard.current();
    if (!canControl || !visible) clearModifiers();
    if (terminal.current) {
      terminal.current.options.disableStdin = !canControl;
      if (canControl && visible) terminal.current.focus();
    }
    resize.current();
  }, [canControl, canResize, visible, clearModifiers]);

  useEffect(() => {
    clearModifiers();
    const element = host.current!;
    const term = new Terminal({
      cols: 100,
      rows: 30,
      scrollback: 500,
      fontSize: 14,
      fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
      lineHeight: 1.18,
      cursorBlink: true,
      cursorStyle: 'bar',
      disableStdin: !controller.current,
      // Default xterm input processing supports mobile keyboards and IME insertText.
      screenReaderMode: false,
      theme: {
        background: '#101216',
        foreground: '#e5e9f1',
        cursor: '#6fa7ff',
        selectionBackground: '#315385',
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(element);
    terminal.current = term;
    term.textarea?.setAttribute(
      'aria-label',
      shellPaneId ? '셸 터미널 입력' : 'Antigravity 터미널 입력',
    );
    term.textarea?.setAttribute('autocapitalize', 'off');
    term.parser.registerOscHandler(52, () => true);
    term.parser.registerOscHandler(8, () => true);
    let disposed = false;
    let epoch = '';
    let sequence = -1;
    let canonical = { cols: 100, rows: 30 };
    let nativeStatus: TuiStatus = 'starting';
    let input: string[] = [];
    discard.current = () => {
      input = [];
    };
    let inputTimer: ReturnType<typeof setTimeout> | undefined;
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    let sending = false;
    let source: EventSource;
    let writes = Promise.resolve();
    let pendingBytes = 0;
    const base = shellPaneId ? `shell/${shellPaneId}` : 'tui';
    const transmit = (path: string, value: Record<string, unknown>) =>
      send(path, { ...value, ...(shellPaneId ? { epoch } : {}) }, projectId, base);

    const flush = async () => {
      if (sending || disposed) return;
      sending = true;
      try {
        while (input.length && controller.current && !disposed) {
          let data = input.shift()!;
          if (data !== '\x1b')
            while (input.length && input[0] !== '\x1b' && data.length + input[0].length <= 8192)
              data += input.shift();
          await transmit('input', { data });
          // Bubble Tea distinguishes bare Escape from Alt+key by arrival timing.
          if (data === '\x1b') await new Promise((done) => setTimeout(done, 100));
        }
      } catch (error) {
        input = [];
        if (!disposed) setError((error as Error).message);
      } finally {
        sending = false;
        if (!controller.current) input = [];
      }
    };
    const enqueue = (data: string) => {
      if (
        !controller.current ||
        disposed ||
        protocolReply.test(data) ||
        (shellPaneId && nativeStatus !== 'ready')
      )
        return;
      data = withTerminalModifiers(data, modifierState.current);
      if (modifierState.current.ctrl || modifierState.current.alt) clearModifiers();
      if (input.reduce((size, part) => size + part.length, 0) + data.length > 32_000) {
        setError('한 번에 입력할 내용이 너무 깁니다.');
        return;
      }
      for (let offset = 0; offset < data.length; offset += 8192)
        input.push(data.slice(offset, offset + 8192));
      clearTimeout(inputTimer);
      inputTimer = setTimeout(() => void flush(), 25);
    };
    transport.current = enqueue;
    term.onData(enqueue);
    let wheelDelta = 0;
    const pageScroll = (up: boolean) => enqueue(up ? '\x1b[5~' : '\x1b[6~');
    term.attachCustomWheelEventHandler((event) => {
      if (!controller.current || term.buffer.active.type !== 'alternate') return true;
      const scaledDelta =
        event.deltaY *
        (event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? 16
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? element.clientHeight
            : 1);
      if (wheelDelta && Math.sign(wheelDelta) !== Math.sign(scaledDelta)) wheelDelta = 0;
      wheelDelta += scaledDelta;
      if (Math.abs(wheelDelta) >= 24) {
        pageScroll(wheelDelta < 0);
        wheelDelta = 0;
      }
      event.preventDefault();
      event.stopPropagation();
      return false;
    });
    let touchPointer: { id: number; y: number } | undefined;
    const pointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'touch' && controller.current)
        touchPointer = { id: event.pointerId, y: event.clientY };
    };
    const pointerUp = (event: PointerEvent) => {
      if (!touchPointer || touchPointer.id !== event.pointerId) return;
      const delta = event.clientY - touchPointer.y;
      touchPointer = undefined;
      if (Math.abs(delta) >= 40) pageScroll(delta > 0);
    };
    const pointerCancel = () => {
      touchPointer = undefined;
    };
    element.addEventListener('pointerdown', pointerDown);
    element.addEventListener('pointerup', pointerUp);
    element.addEventListener('pointercancel', pointerCancel);

    const layout = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (disposed || element.clientWidth < 20 || element.clientHeight < 20) return;
        if (!sizeController.current || nativeStatus !== 'ready') {
          // Spectators view the canonical shared screen; they never resize the PTY.
          term.options.fontSize = Math.max(
            7,
            Math.min(14, (element.clientWidth - 16) / (canonical.cols * 0.61)),
          );
          return;
        }
        term.options.fontSize = window.matchMedia('(max-width: 600px)').matches ? 12 : 14;
        const proposed = fit.proposeDimensions();
        if (!proposed) return;
        const cols = Math.max(30, Math.min(200, proposed.cols));
        const rows = Math.max(10, Math.min(80, proposed.rows));
        if (cols === canonical.cols && rows === canonical.rows) return;
        void transmit('resize', { cols, rows }).catch((error) => {
          if (!disposed) setError((error as Error).message);
        });
      }, 160);
    };
    resize.current = layout;
    const observer = new ResizeObserver(layout);
    observer.observe(element);
    const connect = () => {
      source = new EventSource(`/api/${base}/events?project=${encodeURIComponent(projectId)}`);
      source.onerror = () => {
        if (!disposed) {
          setConnected(false);
          input = [];
          nativeStatus = 'starting';
          clearModifiers();
        }
      };
      source.addEventListener('terminal', (event) => {
        if (disposed) return;
        const frame = JSON.parse(event.data) as TuiFrame;
        nativeStatus = frame.status;
        if (frame.kind === 'data' && (frame.epoch !== epoch || frame.seq !== sequence + 1)) {
          source.close();
          connect();
          return;
        }
        if (epoch !== frame.epoch) {
          input = [];
          clearModifiers();
        }
        epoch = frame.epoch;
        sequence = frame.seq;
        pendingBytes += frame.data.length;
        if (pendingBytes > 1_000_000) {
          pendingBytes -= frame.data.length;
          source.close();
          setError('출력이 많아 화면을 다시 연결합니다.');
          void writes.then(() => {
            if (!disposed) connect();
          });
          return;
        }
        writes = writes.then(
          () =>
            new Promise<void>((done) => {
              if (disposed) return done();
              if (frame.kind === 'reset') {
                term.reset();
                term.resize(frame.cols, frame.rows);
                canonical = { cols: frame.cols, rows: frame.rows };
                layout();
              }
              term.write(frame.data, () => {
                pendingBytes -= frame.data.length;
                done();
              });
            }),
        );
        setConnected(true);
        setStatus(frame.status);
      });
    };
    connect();
    layout();
    return () => {
      disposed = true;
      source.close();
      observer.disconnect();
      element.removeEventListener('pointerdown', pointerDown);
      element.removeEventListener('pointerup', pointerUp);
      element.removeEventListener('pointercancel', pointerCancel);
      clearTimeout(inputTimer);
      clearTimeout(resizeTimer);
      input = [];
      terminal.current = null;
      void writes.then(() => term.dispose());
    };
  }, [projectId, shellPaneId, clearModifiers]);

  return (
    <div className="native-tui">
      <div className="tui-surface">
        <div
          className="tui-viewport"
          ref={host}
          role="region"
          aria-label={shellPaneId ? '셸 터미널 화면' : 'Antigravity TUI 화면'}
          data-connected={connected}
          data-status={status}
          data-controller={canControl}
        />
        {participation}
      </div>
      <div className="tui-status">
        <span className={`dot ${connected && status === 'ready' ? 'green' : 'blue'}`} />
        {connected
          ? shellPaneId
            ? {
                starting: '터미널 시작 중',
                ready: '/workspace · bash',
                stopped: '터미널 종료',
                error: '터미널 연결 오류',
              }[status]
            : statusLabels[status]
          : '터미널 연결 중'}
        <span aria-live="polite">
          {canControl
            ? modifiers.ctrl || modifiers.alt
              ? `${[modifiers.ctrl && 'Ctrl', modifiers.alt && 'Alt'].filter(Boolean).join(' + ')} · 다음 키에 적용`
              : '직접 조작 중'
            : '관람 중 · 입력 잠김'}
        </span>
      </div>
      {shellPaneId && canControl && connected && (status === 'stopped' || status === 'error') && (
        <button
          className="shell-restart"
          onClick={() => {
            setStatus('starting');
            void send('start', {}, projectId, `shell/${shellPaneId}`).catch((error) => {
              setStatus('error');
              setError((error as Error).message);
            });
          }}
        >
          터미널 다시 시작
        </button>
      )}
      {canControl && (
        <div className="tui-keys" aria-label="터미널 보조 키">
          {[
            ['Esc', '\x1b'],
            ['Tab', '\t'],
            ['Ctrl', 'ctrl'],
            ['Alt', 'alt'],
            ['↑', '\x1b[A'],
            ['↓', '\x1b[B'],
            ['←', '\x1b[D'],
            ['→', '\x1b[C'],
            ['PgUp', '\x1b[5~'],
            ['PgDn', '\x1b[6~'],
            ['줄바꿈', '\n'],
            ['Enter', '\r'],
          ].map(([label, data]) => (
            <button
              key={label}
              type="button"
              aria-pressed={data === 'ctrl' || data === 'alt' ? modifiers[data] : undefined}
              title={
                data === 'ctrl' || data === 'alt'
                  ? `${label}: 다음 키에 적용 · 다시 누르면 해제`
                  : undefined
              }
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => {
                if (data === 'ctrl' || data === 'alt') toggleModifier(data);
                else transport.current(data);
                terminal.current?.focus();
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {error && (
        <div className="tui-error" role="alert">
          {error}
          <button onClick={() => setError('')} aria-label="TUI 알림 닫기">
            ×
          </button>
        </div>
      )}
    </div>
  );
}

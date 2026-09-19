import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { Check, Clock3, Circle, LoaderCircle, LockKeyhole, X } from 'lucide-react';
import type { Pane } from '../../shared/protocol';
import { terminalCommand, terminalOutput } from './terminal-log';
import '@xterm/xterm/css/xterm.css';

export function TerminalPane({ pane, now }: { pane: Pane; now: number }) {
  const host = useRef<HTMLDivElement>(null);
  const update = useRef<(value: string) => void>(() => {});
  const process = pane.terminal;
  const running = pane.status === 'active';
  const ready = running && process?.readyAt !== undefined;
  const status = running
    ? process?.port
      ? ready
        ? '서버 실행 중'
        : '서버 시작 중'
      : '실행 중'
    : process?.code === 0
      ? '완료'
      : process?.code == null
        ? '중단됨'
        : '실행 실패';
  const Icon = running ? (ready ? Circle : LoaderCircle) : pane.status === 'done' ? Check : X;
  const duration = Math.max(
    0,
    Math.floor(((process?.finishedAt ?? now) - (process?.startedAt ?? now)) / 1000),
  );
  const elapsed = `${String(Math.floor(duration / 60)).padStart(2, '0')}:${String(duration % 60).padStart(2, '0')}`;

  useEffect(() => {
    const element = host.current!;
    const term = new Terminal({
      cols: 70,
      rows: 12,
      scrollback: 3000,
      fontSize: 13,
      fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
      lineHeight: 1.35,
      convertEol: true,
      cursorBlink: false,
      cursorInactiveStyle: 'none',
      disableStdin: true,
      screenReaderMode: true,
      theme: {
        background: '#0e1116',
        foreground: '#cbd5e1',
        cursor: '#0e1116',
        selectionBackground: '#2d4467',
        black: '#27303d',
        red: '#f48787',
        green: '#8dd6aa',
        yellow: '#e8c680',
        blue: '#83b4ff',
        magenta: '#c3a1ee',
        cyan: '#79c7d9',
        white: '#dce4ef',
        brightBlack: '#8190a5',
        brightRed: '#ffaaaa',
        brightGreen: '#ace8c1',
        brightYellow: '#f7d894',
        brightBlue: '#a6caff',
        brightMagenta: '#d8baff',
        brightCyan: '#9edfea',
        brightWhite: '#f4f7fc',
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(element);
    term.textarea?.setAttribute('readonly', 'true');
    term.textarea?.setAttribute('tabindex', '-1');
    term.textarea?.setAttribute('aria-label', '읽기 전용 실행 출력');
    term.parser.registerOscHandler(52, () => true);
    term.parser.registerOscHandler(8, () => true);
    let disposed = false;
    let writing = false;
    let rendered = '';
    let target = '';
    let frame = 0;
    const write = () => {
      if (disposed || writing || rendered === target) return;
      const next = target;
      const append = next.startsWith(rendered);
      const viewport = term.buffer.active.viewportY;
      const atBottom = viewport === term.buffer.active.baseY;
      const data = append ? next.slice(rendered.length) : next;
      writing = true;
      if (!append) term.reset();
      term.write('\x1b[?25l' + data, () => {
        if (disposed) return;
        rendered = next;
        writing = false;
        if (!atBottom) term.scrollToLine(viewport);
        write();
      });
    };
    update.current = (value) => {
      target = terminalOutput(value);
      write();
    };
    const layout = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (disposed || element.clientWidth < 20 || element.clientHeight < 20) return;
        term.options.fontSize = matchMedia('(max-width: 600px)').matches ? 12 : 13;
        fit.fit();
      });
    };
    const observer = new ResizeObserver(layout);
    observer.observe(element);
    layout();
    return () => {
      disposed = true;
      update.current = () => {};
      observer.disconnect();
      cancelAnimationFrame(frame);
      term.dispose();
    };
  }, [process?.runId]);

  useEffect(() => {
    update.current(pane.content);
  }, [pane.content, process?.runId]);

  return (
    <div className={`terminal-output terminal-tui ${pane.status}`} data-run-id={process?.runId}>
      <div className="terminal-command-block">
        <div className="terminal-location">
          <span>workspace</span>
          <span className="terminal-directory">
            {process?.cwd && process.cwd !== '.' ? `/ ${process.cwd}` : '/'}{' '}
          </span>
          {process?.port && <span className="terminal-port">:{process.port}</span>}
        </div>
        <div className="terminal-command" aria-label="실행 명령">
          <span className="terminal-prompt" aria-hidden="true">
            ❯
          </span>
          <code>
            {process?.command
              ? terminalCommand(process.command)
              : pane.subtitle || '저장된 실행 로그'}
          </code>
        </div>
      </div>
      <div className="terminal-screen-area">
        <div
          ref={host}
          className="terminal-screen"
          role="log"
          aria-label={`${pane.title} 실행 출력`}
          aria-live="off"
        />
        {!pane.content && (
          <div className="terminal-empty">{running ? '출력을 기다리는 중…' : '출력 없음'}</div>
        )}
      </div>
      <div className="terminal-result">
        <span className={`terminal-state ${ready ? 'ready' : ''}`} role="status">
          <Icon size={12} className={running && !ready ? 'spin' : undefined} aria-hidden="true" />
          {status}
        </span>
        {!running && (
          <span className="terminal-exit">
            {process?.code == null ? '종료 코드 확인 불가' : `종료 코드 ${process.code}`}
          </span>
        )}
        <span className="terminal-elapsed" aria-label={`실행 시간 ${duration}초`}>
          <Clock3 size={11} aria-hidden="true" />
          {elapsed}
        </span>
        <span className="terminal-readonly">
          <LockKeyhole size={10} aria-hidden="true" />
          읽기 전용
        </span>
      </div>
    </div>
  );
}

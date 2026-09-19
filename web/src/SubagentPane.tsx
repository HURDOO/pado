import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { Clock3, LoaderCircle } from 'lucide-react';
import type { Pane } from '../../shared/protocol';
import { plainSubagentLog, styledSubagentLog } from './subagent-log';
import '@xterm/xterm/css/xterm.css';

const stateLabels = {
  starting: '위임 준비 중',
  working: '작업 중',
  idle: '응답 완료',
  ended: '실행 종료',
  error: '확인 필요',
};

export function SubagentPane({
  pane,
  now,
  serverOffset,
  reduceMotion,
}: {
  pane: Pane;
  now: number;
  serverOffset: number;
  reduceMotion: boolean;
}) {
  const content = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const updateOutput = useRef<(value: string) => void>(() => {});
  const output = plainSubagentLog(pane.subagent?.output ?? '');
  const state = pane.subagent?.state ?? 'starting';
  const closeAt = pane.subagent?.closeAt;
  const running = state === 'starting' || state === 'working';
  const duration = Math.max(
    0,
    Math.floor(((pane.subagent?.finishedAt ?? now) - (pane.subagent?.startedAt ?? now)) / 1000),
  );
  const remaining =
    closeAt === undefined ? null : Math.max(0, Math.min(3, Math.ceil((closeAt - now) / 1000)));

  useEffect(() => {
    const element = host.current!;
    const term = new Terminal({
      cols: 60,
      rows: 12,
      scrollback: 500,
      fontSize: 13,
      fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
      lineHeight: 1.25,
      cursorBlink: false,
      cursorInactiveStyle: 'none',
      disableStdin: true,
      screenReaderMode: true,
      theme: {
        background: '#101216',
        foreground: '#d5dfed',
        cursor: '#101216',
        selectionBackground: '#315385',
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(element);
    term.textarea?.setAttribute('readonly', 'true');
    term.textarea?.setAttribute('tabindex', '-1');
    term.textarea?.setAttribute('aria-label', '읽기 전용 서브에이전트 실행 로그');
    term.parser.registerOscHandler(52, () => true);
    term.parser.registerOscHandler(8, () => true);
    let disposed = false;
    let writing = false;
    let rendered = '';
    let target = '';
    let layoutFrame = 0;

    const write = () => {
      if (disposed || writing || target === rendered) return;
      const next = target;
      const append = next.startsWith(rendered);
      const viewport = term.buffer.active.viewportY;
      const atBottom = viewport === term.buffer.active.baseY;
      const data = append ? next.slice(rendered.length) : next;
      writing = true;
      if (!append) term.reset();
      term.write(data.replace(/\n/g, '\r\n'), () => {
        if (disposed) return;
        rendered = next;
        writing = false;
        if (!append && !atBottom) term.scrollToLine(viewport);
        write();
      });
    };
    updateOutput.current = (value) => {
      target = styledSubagentLog(value);
      write();
    };
    const layout = () => {
      cancelAnimationFrame(layoutFrame);
      layoutFrame = requestAnimationFrame(() => {
        if (disposed || element.clientWidth < 20 || element.clientHeight < 20) return;
        term.options.fontSize = window.matchMedia('(max-width: 600px)').matches ? 12 : 13;
        fit.fit();
      });
    };
    const observer = new ResizeObserver(layout);
    observer.observe(element);
    layout();
    return () => {
      disposed = true;
      updateOutput.current = () => {};
      observer.disconnect();
      cancelAnimationFrame(layoutFrame);
      term.dispose();
    };
  }, []);

  useEffect(() => {
    updateOutput.current(output);
  }, [output]);

  useEffect(() => {
    if (closeAt === undefined || running || reduceMotion) return;
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    if (motion.matches) return;
    // This only animates the server-owned close deadline. The SSE snapshot removes the pane.
    const animation = content.current?.closest('.pane')?.animate(
      [
        { opacity: 1, transform: 'translateY(0) scale(1)' },
        { opacity: 0, transform: 'translateY(6px) scale(.98)' },
      ],
      {
        duration: 220,
        delay: Math.max(0, closeAt - Date.now() - serverOffset - 220),
        easing: 'ease-in',
        fill: 'forwards',
      },
    );
    const cancel = () => animation?.cancel();
    motion.addEventListener('change', cancel);
    return () => {
      cancel();
      motion.removeEventListener('change', cancel);
    };
  }, [closeAt, running, serverOffset, reduceMotion]);

  return (
    <div ref={content} className={`subagent-content subagent-tui ${state}`}>
      <div className="subagent-terminal-area">
        <div
          ref={host}
          className="subagent-terminal"
          role="log"
          aria-label={`${pane.title} 실행 로그`}
          aria-live="off"
        />
        {!output && <div className="subagent-empty">실행 로그를 기다리는 중…</div>}
      </div>
      <div className="subagent-terminal-footer">
        <span className="subagent-state" role="status">
          {running && <LoaderCircle size={12} className="spin" aria-hidden="true" />}
          {stateLabels[state]}
        </span>
        <span className="subagent-readonly">읽기 전용 실행 로그</span>
        <span className="subagent-duration" aria-label={`작업 시간 ${duration}초`}>
          <Clock3 size={11} aria-hidden="true" />
          {duration < 60 ? `${duration}초` : `${Math.floor(duration / 60)}분 ${duration % 60}초`}
        </span>
        {!running && remaining !== null && (
          <span className="subagent-lifecycle">
            {remaining > 0 ? `${remaining}초 후 pane이 닫혀요` : 'pane을 정리하고 있어요'}
          </span>
        )}
      </div>
    </div>
  );
}

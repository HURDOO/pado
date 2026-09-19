/** In-process callbacks only. Never accept these events from a presentation bridge or HTTP. */
export type TerminalEvent = { id: string; runId: string } & (
  | {
      type: 'terminal.open';
      title: string;
      subtitle: string;
      size: number;
      foreground?: boolean;
      startedAt?: number;
      command?: string[];
      cwd?: string;
      port?: 3000 | 3001 | 5173 | 8080;
    }
  | { type: 'terminal.append'; stream: 'stdout' | 'stderr'; text: string }
  | { type: 'terminal.ready' }
  | { type: 'terminal.exit'; code: number | null }
);

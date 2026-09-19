import { randomUUID } from 'node:crypto';
import xterm from '@xterm/headless';
import serializer from '@xterm/addon-serialize';
import type { TuiFrame, TuiStatus } from '../shared/protocol.ts';

export class TerminalScreen {
  readonly epoch = randomUUID();
  private terminal: InstanceType<typeof xterm.Terminal>;
  private serializer = new serializer.SerializeAddon();
  private sequence = 0;
  status: TuiStatus = 'starting';
  private disposed = false;
  private queue = Promise.resolve();
  private queuedBytes = 0;
  onFlow?: (paused: boolean) => void;
  constructor(
    public cols = 100,
    public rows = 30,
    private emit: (frame: TuiFrame) => void = () => {},
    reply: (data: string) => void = () => {},
  ) {
    this.terminal = new xterm.Terminal({
      cols,
      rows,
      scrollback: 500,
      allowProposedApi: true,
      theme: { background: '#101216', foreground: '#e5e9f1' },
    });
    this.terminal.loadAddon(this.serializer);
    // No clipboard access or executable terminal links, on either end of the stream.
    this.terminal.parser.registerOscHandler(52, () => true);
    this.terminal.parser.registerOscHandler(8, () => true);
    this.terminal.onData(reply);
  }
  write(data: string) {
    this.queuedBytes += Buffer.byteLength(data);
    if (this.queuedBytes > 128_000) this.onFlow?.(true);
    this.queue = this.queue.then(
      () =>
        new Promise<void>((done) => {
          if (this.disposed) return done();
          this.terminal.write(data, () => {
            this.queuedBytes -= Buffer.byteLength(data);
            if (this.queuedBytes < 32_000) this.onFlow?.(false);
            if (!this.disposed)
              this.emit({
                kind: 'data',
                epoch: this.epoch,
                seq: ++this.sequence,
                cols: this.cols,
                rows: this.rows,
                status: this.status,
                data,
              });
            done();
          });
        }),
    );
    return this.queue;
  }
  async resize(cols: number, rows: number) {
    await this.queue;
    if (this.disposed) return;
    this.cols = cols;
    this.rows = rows;
    this.terminal.resize(cols, rows);
    this.emit(this.snapshot());
  }
  setStatus(status: TuiStatus) {
    this.status = status;
    this.emit(this.snapshot());
  }
  snapshot(): TuiFrame {
    const buffer = this.terminal.buffer.active;
    const text = Array.from(
      { length: buffer.length },
      (_, index) => buffer.getLine(index)?.translateToString(true) || '',
    ).join('\n');
    return {
      kind: 'reset',
      epoch: this.epoch,
      seq: this.sequence,
      cols: this.cols,
      rows: this.rows,
      status: this.status,
      data: this.serializer.serialize({ scrollback: 500 }),
      text,
    };
  }
  async flush() {
    await this.queue;
  }
  dispose() {
    this.disposed = true;
    void this.queue.then(() => this.terminal.dispose());
  }
}

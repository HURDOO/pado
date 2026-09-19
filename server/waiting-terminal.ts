import { z } from 'zod';
import type { RuntimeRequest } from '../shared/protocol.ts';
import type { TerminalEvent } from './terminal-events.ts';

export const commandWaitSchema = z
  .object({
    conversationId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
    turnToken: z.uuid(),
    at: z.number().int().nonnegative(),
    steps: z.array(z.number().int().nonnegative()).max(64),
  })
  .strict();
export type CommandWait = z.infer<typeof commandWaitSchema>;

/** Real runtime callbacks, buffered until matching native waiting evidence arrives. */
export class WaitingTerminal {
  private open?: Extract<TerminalEvent, { type: 'terminal.open' }>;
  private buffered: Extract<TerminalEvent, { type: 'terminal.append' }>[] = [];
  private size = 0;
  private shown = false;
  private ended = false;
  constructor(
    private request: RuntimeRequest,
    private emit: (event: TerminalEvent) => void,
  ) {}
  event(event: TerminalEvent) {
    if (this.ended || event.runId !== this.request.requestId) return;
    if (this.shown) this.emit(event);
    else if (event.type === 'terminal.open') this.open = event;
    else if (event.type === 'terminal.append') {
      const previous = this.buffered.at(-1);
      if (previous?.stream === event.stream) previous.text += event.text;
      else this.buffered.push({ ...event });
      this.size += event.text.length;
      while (this.size > 60000 || this.buffered.length > 128) {
        const first = this.buffered[0];
        const remove =
          this.buffered.length > 128
            ? first.text.length
            : Math.min(first.text.length, this.size - 60000);
        first.text = first.text.slice(remove);
        this.size -= remove;
        if (!first.text) this.buffered.shift();
      }
    }
    if (event.type === 'terminal.exit') this.finish();
  }
  update(wait: CommandWait | undefined, eligible: boolean, now = Date.now()) {
    const binding = this.request.waitFor;
    if (
      this.ended ||
      this.shown ||
      !this.open ||
      !eligible ||
      !binding ||
      !wait ||
      now - wait.at > 1500 ||
      wait.at > now + 250 ||
      binding.conversationId !== wait.conversationId ||
      binding.turnToken !== wait.turnToken ||
      !wait.steps.includes(binding.step)
    )
      return;
    // No focus jump: an Input/Context/mobile reader retains their current surface.
    try {
      this.emit({ ...this.open, foreground: false });
    } catch {
      return;
    } // Full layout or protected ID must never stop the actual command.
    this.shown = true;
    for (const event of this.buffered) this.emit(event);
    this.buffered = [];
    this.size = 0;
  }
  finish() {
    this.ended = true;
    this.buffered = [];
    this.open = undefined;
    this.size = 0;
  }
}

import { z } from 'zod';

export const speakerLeaseSeconds = 30;
export const speakerLeaseMs = speakerLeaseSeconds * 1000;

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
export const secretNameSchema = z
  .string()
  .regex(/^[A-Z][A-Z0-9_]{0,79}$/)
  .refine(
    (name) =>
      !/^(?:PADO_|VITE_|NEXT_PUBLIC_|PUBLIC_|NODE_|NPM_|PNPM_|LD_|DYLD_|XDG_|GIT_|SSH_)/.test(
        name,
      ) &&
      ![
        'PATH',
        'HOME',
        'USER',
        'LOGNAME',
        'SHELL',
        'ENV',
        'BASH_ENV',
        'PORT',
        'HOST',
        'HOSTNAME',
        'TERM',
        'TMPDIR',
        'NODE',
        'NODE_PATH',
        'NODE_OPTIONS',
      ].includes(name),
    'Use an application secret name, not a public or runtime configuration variable',
  );
export const secretValueSchema = z
  .string()
  .min(1)
  .max(8000)
  .refine((value) => !value.includes('\0'));
export const secretInputSchema = z
  .object({ name: secretNameSchema, description: z.string().max(600).default('') })
  .strict();
export const subagentStateSchema = z.enum(['starting', 'working', 'idle', 'ended', 'error']);
export const subagentProgressSchema = z.object({
  id,
  name: z.string().regex(/^[a-zA-Z][a-zA-Z0-9 _-]{0,47}$/),
  state: subagentStateSchema,
});
export type SubagentProgress = z.infer<typeof subagentProgressSchema>;
export const subagentPaneSchema = z.object({
  state: subagentStateSchema,
  startedAt: z.number().finite(),
  finishedAt: z.number().finite().optional(),
  closeAt: z.number().finite().optional(),
  output: z.string().max(16_000).optional(),
});
export const previewPorts = [3000, 3001, 5173, 8080] as const;
export const previewPortSchema = z.union([
  z.literal(3000),
  z.literal(3001),
  z.literal(5173),
  z.literal(8080),
]);
export const serverPreviewSchema = z
  .object({
    port: previewPortSchema,
    // Control characters are intentionally excluded from URL paths.
    path: z
      .string()
      .max(500)
      // oxlint-disable-next-line no-control-regex
      .regex(/^\/(?!\/)[^\\\s\u0000-\u001f]*$/)
      .default('/'),
  })
  .strict();
export const decisionSchema = z
  .object({
    question: z.string().min(1).max(240),
    context: z.string().max(600).default(''),
    options: z
      .array(
        z
          .object({
            id,
            title: z.string().min(1).max(80),
            summary: z.string().min(1).max(300),
            tradeoff: z.string().min(1).max(300),
            preview: z.string().min(1).max(10_000),
          })
          .strict(),
      )
      .min(2)
      .max(4)
      .refine(
        (options) => new Set(options.map((option) => option.id)).size === options.length,
        'Option IDs must be unique',
      ),
  })
  .strict();
export const decisionAnswerSchema = z
  .object({
    optionId: id,
    note: z.string().max(1000).default(''),
  })
  .strict();
export const reviewRunSchema = z
  .object({
    id: z.uuid(),
    code: z.number().int().nullable(),
    at: z.number().finite(),
  })
  .strict();
// The host binds published working context to its turn and carries it into Review.
export const workContextSchema = z
  .object({
    turnId: z.uuid(),
    title: z.string().min(1).max(100),
    content: z.string().min(1).max(60_000),
    updatedAt: z.number().finite(),
    state: z.enum(['working', 'finished', 'interrupted']),
  })
  .strict();
export const reviewSchema = z
  .object({
    summary: z.string().min(1).max(600),
    changes: z
      .array(
        z
          .object({
            title: z.string().min(1).max(120),
            detail: z.string().min(1).max(800),
            files: z.array(z.string().min(1).max(200)).max(12).default([]),
          })
          .strict(),
      )
      .max(12),
    checks: z
      .array(
        z
          .object({
            id,
            label: z.string().min(1).max(160),
            status: z.enum(['passed', 'failed', 'unverified']),
            evidence: z.string().max(2000).default(''),
            runId: z.uuid().optional(),
            run: reviewRunSchema.optional(),
            reproduction: serverPreviewSchema.optional(),
          })
          .strict(),
      )
      .max(20)
      .refine(
        (checks) => new Set(checks.map((check) => check.id)).size === checks.length,
        'Check IDs must be unique',
      ),
    limitations: z.array(z.string().min(1).max(600)).max(12),
  })
  .strict();
export const paneSchema = z
  .object({
    id,
    kind: z.enum([
      'docs',
      'tasks',
      'context',
      'terminal',
      'file',
      'input',
      'browser',
      'subagent',
      'review',
    ]),
    title: z.string().min(1).max(100),
    content: z.string().max(60_000).default(''),
    subtitle: z.string().max(180).default(''),
    size: z.number().min(1).max(3).default(1),
    status: z.enum(['active', 'done', 'error']).default('active'),
    manual: z.literal(true).optional(),
    shell: z.literal(true).optional(),
    server: serverPreviewSchema.optional(),
    subagent: subagentPaneSchema.optional(),
    decision: decisionSchema.optional(),
    secret: secretInputSchema.optional(),
    answer: decisionAnswerSchema.optional(),
    review: reviewSchema.optional(),
    workContext: workContextSchema.optional(),
    terminal: z
      .object({
        runId: z.uuid(),
        startedAt: z.number().finite(),
        command: z.array(z.string().max(4000)).min(1).max(64).optional(),
        cwd: z.string().max(200).optional(),
        port: previewPortSchema.optional(),
        readyAt: z.number().finite().optional(),
        finishedAt: z.number().finite().optional(),
        code: z.number().int().nullable().optional(),
      })
      .strict()
      .optional(),
  })
  .refine(
    (pane) => !pane.shell || (pane.kind === 'terminal' && !!pane.manual && !!pane.terminal),
    'Interactive shells are server-managed manual Terminal panes',
  )
  .refine(
    (pane) => !pane.server || (pane.kind === 'browser' && !pane.content),
    'Server previews belong to an empty Browser pane',
  )
  .refine(
    (pane) =>
      pane.kind === 'subagent' ? !!pane.subagent && !pane.content && !pane.server : !pane.subagent,
    'Subagent metadata belongs to a server-managed Subagent pane',
  )
  .refine(
    (pane) =>
      (!pane.decision || (pane.kind === 'input' && !pane.content)) &&
      (!pane.answer || !!pane.decision),
    'Decision data belongs to an empty Input pane',
  )
  .refine(
    (pane) =>
      !pane.secret || (pane.kind === 'input' && !pane.content && !pane.decision && !pane.answer),
    'Secret requests belong to an empty native Input pane',
  )
  .refine(
    (pane) => (pane.kind === 'review' ? !!pane.review && !pane.content : !pane.review),
    'Review data belongs to an empty Review pane',
  )
  .refine(
    (pane) =>
      (pane.kind !== 'context' || !!pane.content.trim()) &&
      (!pane.workContext || pane.kind === 'context' || pane.kind === 'review'),
    'Working context requires Markdown and belongs only to Context or Review',
  )
  .refine(
    (pane) => !pane.terminal || pane.kind === 'terminal',
    'Process metadata belongs to a server-managed Terminal pane',
  );
export const runtimeRequestSchema = z
  .object({
    requestId: z.uuid(),
    action: z.enum(['exec', 'run', 'serve', 'stop', 'secrets']),
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,48}$/),
    port: previewPortSchema.optional(),
    display: z.enum(['terminal', 'waiting', 'none']).default('terminal'),
    waitFor: z
      .object({
        conversationId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
        turnToken: z.uuid(),
        step: z.number().int().nonnegative(),
      })
      .strict()
      .optional(),
    secrets: z
      .array(secretNameSchema)
      .max(20)
      .refine((names) => new Set(names).size === names.length)
      .optional(),
    cwd: z
      .string()
      .max(200)
      .regex(/^(?:\.|[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_.-]+)*)$/)
      .default('.')
      .refine((value) => !value.split('/').includes('..')),
    command: z
      .array(
        z
          .string()
          .max(4000)
          .refine((value) => !value.includes('\0')),
      )
      .min(1)
      .max(64)
      .optional(),
  })
  .strict()
  .refine((value) => ['stop', 'secrets'].includes(value.action) || !!value.command)
  .refine((value) => value.action !== 'serve' || !!value.port);
export type RuntimeRequest = z.infer<typeof runtimeRequestSchema>;
export type PreviewInfo = {
  url: string;
  state: 'starting' | 'running' | 'stopped' | 'error';
  epoch: string;
};
export const presentationSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('pane.upsert'),
    pane: paneSchema.refine(
      (pane) =>
        pane.kind !== 'subagent' &&
        pane.kind !== 'terminal' &&
        !pane.manual &&
        !pane.shell &&
        !pane.id.startsWith('user-') &&
        !pane.terminal &&
        !pane.id.startsWith('subagent-') &&
        !pane.answer &&
        !pane.workContext &&
        !pane.review?.checks.some((check) => check.run),
      'Terminal/Subagent panes, working context provenance, decision answers and verified runs are managed by the server',
    ),
  }),
  z.object({ type: z.literal('pane.close'), id }),
  z.object({ type: z.literal('pane.show'), id, size: z.number().min(1).max(3).optional() }),
  z.object({ type: z.literal('pane.focus'), id }),
  z.object({ type: z.literal('pane.resize'), id, size: z.number().min(1).max(3) }),
  z.object({ type: z.literal('agent.message'), text: z.string().min(1).max(12_000) }),
]);
export type Presentation = z.infer<typeof presentationSchema>;
export type Pane = z.infer<typeof paneSchema>;
export type PaneCatalogItem = Pick<Pane, 'id' | 'kind' | 'title' | 'size' | 'status'> & {
  visible: boolean;
};
export const addPaneSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('terminal') }).strict(),
  z.object({ kind: z.literal('browser'), server: serverPreviewSchema }).strict(),
  z.object({ kind: z.literal('saved'), id }).strict(),
]);
export type AddPaneRequest = z.infer<typeof addPaneSchema>;
export type Participant = { id: string; nickname: string; online: boolean };
export type Message = {
  id: string;
  author: 'agent' | 'user' | 'system';
  text: string;
  at: number;
  nickname?: string;
};
export type AgentActivity = {
  phase: 'planning' | 'reading' | 'writing' | 'running' | 'delegating' | 'reviewing';
  subagents: SubagentProgress[];
};
export type Stage = {
  revision: number;
  title: string;
  runner: 'rehearsal' | 'antigravity';
  phase: 'idle' | 'running' | 'waiting' | 'error';
  participants: Participant[];
  speaker: { participantId: string; expiresAt: number } | null;
  turn: { id: string; participantId: string; prompt: string; startedAt: number } | null;
  panes: Pane[];
  focusId: string;
  focusVersion: number;
  messages: Message[];
  activity: AgentActivity | null;
  serverTime: number;
};
export type Session = { id: string; nickname: string; admin: boolean };
export type TuiStatus = 'starting' | 'ready' | 'stopped' | 'error';
export type TuiFrame = {
  kind: 'reset' | 'data';
  epoch: string;
  seq: number;
  cols: number;
  rows: number;
  status: TuiStatus;
  data: string;
  text?: string;
};
export const projectSchema = z.object({
  id: z.string().regex(/^(?:default|[a-f0-9-]{36})$/),
  name: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[^\p{Cc}\p{Cf}]+$/u),
  slot: z.number().int().min(0).max(11),
});
export type Project = z.infer<typeof projectSchema>;
export type Snapshot = {
  stage: Stage;
  me: Session;
  adminAvailable: boolean;
  publicMode?: boolean;
  /** Server-owned opt-in to native controls; leases and project write guards still apply. */
  participantTui?: boolean;
  workspace: {
    activeId: string;
    /** The project shown in this tab. Omitted only by pre-multi-session servers/fixtures. */
    viewedId?: string;
    activeBusy?: boolean;
    projects: Project[];
    switching: boolean;
  };
};

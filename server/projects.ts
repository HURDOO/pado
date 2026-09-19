import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { z } from 'zod';
import {
  paneSchema,
  projectSchema,
  runtimeRequestSchema,
  type RuntimeRequest,
  type Project,
} from '../shared/protocol.ts';
import { StageError, StageStore } from './stage.ts';

const conversationId = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const registrySchema = z
  .object({
    version: z.literal(1),
    activeId: projectSchema.shape.id,
    projects: z.array(projectSchema).min(1).max(12),
  })
  .refine(
    (value) =>
      value.projects.some((project) => project.id === value.activeId) &&
      new Set(value.projects.map((project) => project.id)).size === value.projects.length &&
      new Set(value.projects.map((project) => project.slot)).size === value.projects.length &&
      value.projects.every((project) => (project.id === 'default') === (project.slot === 0)),
  );
const artifact = paneSchema.refine((pane) => pane.kind !== 'input' && pane.kind !== 'subagent');
const checkpointSchema = z.object({
  panes: z.array(artifact).max(6),
  savedPanes: z.array(artifact).max(24),
  focusId: z.string().max(64),
  messages: z
    .array(
      z.object({
        id: z.string().max(100),
        author: z.enum(['agent', 'user', 'system']),
        text: z.string().max(12000),
        at: z.number().finite(),
        nickname: z.string().max(24).optional(),
      }),
    )
    .max(60),
});
export type ProjectState = ReturnType<StageStore['checkpoint']>;

/** Host-private metadata. Project names and agent files never select a host path. */
export class Projects {
  private registry!: z.infer<typeof registrySchema>;
  private writes = Promise.resolve();
  constructor(readonly root = resolve(process.env.PADO_DATA_DIR || '.pado')) {}
  async init() {
    await mkdir(this.root, { recursive: true });
    try {
      this.registry = registrySchema.parse(
        JSON.parse(await readFile(resolve(this.root, 'projects.json'), 'utf8')),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      this.registry = {
        version: 1,
        activeId: 'default',
        projects: [{ id: 'default', name: '기존 프로젝트', slot: 0 }],
      };
      await this.persist();
    }
    return this;
  }
  get active() {
    return this.get(this.registry.activeId);
  }
  list() {
    return this.registry.projects.map((project) => ({ ...project }));
  }
  get(id: string): Project {
    const project = this.registry.projects.find((item) => item.id === id);
    if (!project) throw new StageError('프로젝트가 없습니다.', 404);
    return { ...project };
  }
  paths(id: string) {
    this.get(id);
    const root = resolve(this.root, 'projects', id);
    return {
      root,
      workspace: id === 'default' ? resolve(this.root, 'workspace') : resolve(root, 'workspace'),
    };
  }
  async create(name: string) {
    if (this.registry.projects.length >= 12)
      throw new StageError('프로젝트는 최대 12개까지 만들 수 있습니다.');
    const project = projectSchema.parse({
      id: randomUUID(),
      name,
      slot: this.registry.projects.length,
    });
    if (this.registry.projects.some((item) => item.name === project.name))
      throw new StageError('같은 이름의 프로젝트가 있습니다.');
    this.registry.projects.push(project);
    try {
      await this.persist();
    } catch (error) {
      this.registry.projects.pop();
      throw error;
    }
    return project;
  }
  async activate(id: string) {
    this.get(id);
    const previous = this.registry.activeId;
    this.registry.activeId = id;
    try {
      await this.persist();
    } catch (error) {
      this.registry.activeId = previous;
      throw error;
    }
  }
  async rename(id: string, name: string) {
    const current = this.get(id);
    const updated = projectSchema.parse({ ...current, name });
    if (this.registry.projects.some((item) => item.id !== id && item.name === updated.name))
      throw new StageError('같은 이름의 프로젝트가 있습니다.');
    const index = this.registry.projects.findIndex((item) => item.id === id);
    this.registry.projects[index] = updated;
    try {
      await this.persist();
    } catch (error) {
      this.registry.projects[index] = current;
      throw error;
    }
    return updated;
  }
  async load(id: string): Promise<ProjectState> {
    try {
      return checkpointSchema.parse(
        JSON.parse(await readFile(resolve(this.paths(id).root, 'stage.json'), 'utf8')),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return new StageStore().checkpoint();
    }
  }
  save(id: string, state: ProjectState) {
    return this.atomic(resolve(this.paths(id).root, 'stage.json'), checkpointSchema.parse(state));
  }
  async conversation(id: string) {
    try {
      const data = JSON.parse(
        await readFile(resolve(this.paths(id).root, 'conversation.json'), 'utf8'),
      );
      return z.object({ id: conversationId.optional() }).parse(data).id;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return undefined;
    }
  }
  saveConversation(id: string, value?: string) {
    return this.atomic(resolve(this.paths(id).root, 'conversation.json'), {
      id: value === undefined ? undefined : conversationId.parse(value),
    });
  }
  async app(id: string) {
    try {
      const value = JSON.parse(await readFile(resolve(this.paths(id).root, 'app.json'), 'utf8'));
      if (value === null) return undefined;
      return runtimeRequestSchema.refine((request) => request.action === 'serve').parse(value);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return undefined;
    }
  }
  saveApp(id: string, value?: RuntimeRequest) {
    return this.atomic(
      resolve(this.paths(id).root, 'app.json'),
      value
        ? runtimeRequestSchema.refine((request) => request.action === 'serve').parse(value)
        : null,
    );
  }
  private persist() {
    return this.atomic(resolve(this.root, 'projects.json'), this.registry);
  }
  private atomic(file: string, value: unknown) {
    const content = JSON.stringify(value);
    const task = this.writes.then(async () => {
      await mkdir(resolve(file, '..'), { recursive: true });
      const temporary = `${file}.${randomUUID()}.tmp`;
      await writeFile(temporary, content, { mode: 0o600, flag: 'wx' });
      await rename(temporary, file);
    });
    this.writes = task.catch(() => {});
    return task;
  }
}

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { z } from 'zod';
import { secretNameSchema, secretValueSchema } from '../shared/protocol.ts';
import { StageError } from './stage.ts';

const valuesSchema = z
  .record(secretNameSchema, secretValueSchema)
  .refine((values) => Object.keys(values).length <= 40);

/** Demo-only plaintext storage outside the agent/app workspace and presentation snapshots. */
export class ProjectSecrets {
  private writes = Promise.resolve();
  constructor(private readonly root: string) {}
  private async read(): Promise<Record<string, string>> {
    try {
      return valuesSchema.parse(
        JSON.parse(await readFile(resolve(this.root, 'secrets.json'), 'utf8')),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
      // Neither parser diagnostics nor the private filename belong in agent/user output.
      throw new StageError('프로젝트 실행 환경 설정을 읽지 못했습니다.', 503);
    }
  }
  async names() {
    await this.writes;
    return Object.keys(await this.read()).sort();
  }
  async environment(names: string[]) {
    names.forEach((name) => secretNameSchema.parse(name));
    await this.writes;
    if (!names.length) return {};
    const stored = await this.read();
    const selected: Record<string, string> = {};
    for (const name of names) {
      if (!Object.hasOwn(stored, name))
        throw new StageError(
          `${name} 설정이 필요합니다. 시크릿 Input으로 입력을 요청해 주세요.`,
          400,
        );
      selected[name] = stored[name];
    }
    return selected;
  }
  set(name: string, value: string) {
    secretNameSchema.parse(name);
    secretValueSchema.parse(value);
    const task = this.writes.then(async () => {
      const next = valuesSchema.parse({ ...(await this.read()), [name]: value });
      await mkdir(this.root, { recursive: true, mode: 0o700 });
      const temporary = resolve(this.root, `.secrets-${randomUUID()}.tmp`);
      await writeFile(temporary, JSON.stringify(next), { mode: 0o600, flag: 'wx' });
      await rename(temporary, resolve(this.root, 'secrets.json'));
    });
    this.writes = task.catch(() => {});
    return task;
  }
}

/** Exact-value masking for accidental stdout/stderr disclosure, including split chunks.
 * This is not protection from code intentionally encoding or exfiltrating credentials. */
export class SecretOutputFilter {
  private pending = '';
  private readonly pattern?: RegExp;
  private readonly keep: number;
  constructor(values: string[]) {
    const unique = [...new Set(values)].filter(Boolean).sort((a, b) => b.length - a.length);
    this.keep = Math.max(0, ...unique.map((value) => value.length - 1));
    if (unique.length)
      this.pattern = new RegExp(
        unique.map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
        'g',
      );
  }
  write(chunk: string, final = false) {
    if (!this.pattern) return chunk;
    this.pending += chunk;
    let boundary = final ? this.pending.length : Math.max(0, this.pending.length - this.keep);
    let output = '';
    let cursor = 0;
    this.pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = this.pattern.exec(this.pending)) && match.index < boundary) {
      output += this.pending.slice(cursor, match.index) + '[REDACTED]';
      cursor = match.index + match[0].length;
      boundary = Math.max(boundary, cursor);
    }
    output += this.pending.slice(cursor, boundary);
    this.pending = this.pending.slice(boundary);
    return output;
  }
}

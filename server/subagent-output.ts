import { constants } from 'node:fs';
import { open } from 'node:fs/promises';

/** Optional, replace-in-place worker output; invalid files never interrupt the native PTY. */
export class SubagentOutputSnapshot {
  private version = '';
  constructor(private file: string) {}
  async read(): Promise<unknown[]> {
    let file;
    try {
      file = await open(
        this.file,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > 4_500_000) return [];
      const version = `${stat.ino}:${stat.size}:${stat.mtimeMs}`;
      if (version === this.version) return [];
      const buffer = Buffer.alloc(stat.size);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      if (bytesRead !== stat.size) return [];
      const rows: unknown = JSON.parse(buffer.toString('utf8'));
      if (!Array.isArray(rows) || rows.length > 64) return [];
      this.version = version;
      return rows;
    } catch {
      return [];
    } finally {
      await file?.close();
    }
  }
}

import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { StringDecoder } from 'node:string_decoder';

export class PresentationJournal {
  private offset = 0;
  private partial = '';
  private decoder = new StringDecoder('utf8');
  constructor(
    private file: string,
    private maxBytes = 4_000_000,
  ) {}
  async read(): Promise<unknown[]> {
    let file;
    try {
      file = await open(
        this.file,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > this.maxBytes || stat.size < this.offset)
        throw new Error('Invalid presentation journal');
      const data = Buffer.alloc(stat.size - this.offset);
      const read = await file.read(data, 0, data.length, this.offset);
      this.offset += read.bytesRead;
      this.partial += this.decoder.write(data.subarray(0, read.bytesRead));
      const lines = this.partial.split('\n');
      this.partial = lines.pop() || '';
      if (this.partial.length > 80_000) throw new Error('Oversized presentation event');
      return lines.flatMap((line) => {
        if (line.length > 80_000) throw new Error('Oversized presentation event');
        try {
          return [JSON.parse(line) as unknown];
        } catch {
          return [];
        }
      });
    } finally {
      await file.close();
    }
  }
}

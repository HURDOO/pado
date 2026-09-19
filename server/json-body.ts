import { StageError } from './stage.ts';

export async function readJsonBody(
  source: AsyncIterable<Buffer | string>,
  limit = 80_000,
): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of source) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > limit) throw new StageError('요청 크기를 초과했습니다.', 413);
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new StageError('올바른 JSON이 아닙니다.', 400);
  }
}

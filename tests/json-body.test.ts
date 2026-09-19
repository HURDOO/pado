import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { readJsonBody } from '../server/json-body.ts';

test('JSON requests preserve Korean and emoji across arbitrary TCP chunk boundaries', async () => {
  const expected = { prompt: '파도 🌊 함께 만들어 줘', values: { theme: '푸른 바다' } };
  const bytes = Buffer.from(JSON.stringify(expected));
  const chunks = Array.from(bytes, (byte) => Buffer.from([byte]));
  assert.deepEqual(await readJsonBody(Readable.from(chunks)), expected);
});
test('JSON request size is bounded in bytes before parsing', async () => {
  await assert.rejects(readJsonBody(Readable.from([Buffer.from('"가가가가"')]), 10), {
    status: 413,
  });
});
test('malformed JSON returns a safe client error', async () => {
  await assert.rejects(
    readJsonBody(Readable.from(['{ not-json secret-value'])),
    (error: unknown) =>
      error instanceof Error &&
      !error.message.includes('secret-value') &&
      error.message.includes('JSON'),
  );
});

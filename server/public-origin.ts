import { isIP } from 'node:net';
import type { IncomingMessage } from 'node:http';
export { publicPreviewOrigin } from '../shared/preview-origin.ts';

export function visitorAddress(req: IncomingMessage, trustCloudflare: boolean) {
  const peer = req.socket.remoteAddress || 'unknown';
  const forwarded = req.headers['cf-connecting-ip'];
  if (
    trustCloudflare &&
    ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer) &&
    typeof forwarded === 'string' &&
    isIP(forwarded)
  )
    return forwarded;
  return peer;
}

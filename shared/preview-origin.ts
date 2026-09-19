import { previewPorts } from './protocol.ts';

/** One first-level hostname per project and app port, covered by the zone's edge TLS. */
export function publicPreviewOrigin(parentOrigin: string, slot: number, port: number) {
  const parent = new URL(parentOrigin);
  const [label, ...zone] = parent.hostname.split('.');
  if (
    parent.protocol !== 'https:' ||
    parent.port ||
    parent.username ||
    parent.password ||
    parent.pathname !== '/' ||
    parent.search ||
    parent.hash ||
    zone.length < 2 ||
    !/^[a-z0-9-]+$/.test(label) ||
    !Number.isInteger(slot) ||
    slot < 0 ||
    slot > 11 ||
    !previewPorts.includes(port as (typeof previewPorts)[number])
  )
    throw new Error('A valid public HTTPS origin, project slot and approved port are required');
  return `https://${label}-app-${slot}-${port}.${zone.join('.')}`;
}

export function isIsolatedPreviewUrl(value: string, parentOrigin: string, port: number) {
  try {
    const url = new URL(value);
    const parent = new URL(parentOrigin);
    if (
      url.username ||
      url.password ||
      url.origin === parent.origin ||
      url.protocol !== parent.protocol
    )
      return false;
    if (parent.protocol === 'http:') return url.hostname === parent.hostname;
    return Array.from({ length: 12 }, (_, slot) =>
      publicPreviewOrigin(parentOrigin, slot, port),
    ).includes(url.origin);
  } catch {
    return false;
  }
}

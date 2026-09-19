export type TerminalModifiers = { ctrl: boolean; alt: boolean };

/** Encode one virtual modifier chord using the terminal's normal VT key codes. */
export function withTerminalModifiers(data: string, modifiers: TerminalModifiers): string {
  const flags = (modifiers.ctrl ? 4 : 0) | (modifiers.alt ? 2 : 0);
  if (!flags) return data;
  // Preserve existing Shift/Alt/Ctrl flags, including application-cursor keys.
  // oxlint-disable-next-line no-control-regex
  const cursor = /^\x1b(?:\[|O)(?:1;([2-8]))?([ABCDHF])$/.exec(data);
  if (cursor) return `\x1b[1;${((Number(cursor[1] || 1) - 1) | flags) + 1}${cursor[2]}`;
  // Never reinterpret pasted text, composition batches or terminal sequences.
  if (data.length !== 1 || data.charCodeAt(0) > 127) return data;
  let key = data;
  if (modifiers.ctrl) {
    if (/^[a-z]$/i.test(key)) key = String.fromCharCode(key.toUpperCase().charCodeAt(0) - 64);
    else if (key === ' ' || key === '@' || key === '2') key = '\x00';
    else if (key === '[' || key === '3') key = '\x1b';
    else if (key === '\\' || key === '4') key = '\x1c';
    else if (key === ']' || key === '5') key = '\x1d';
    else if (key === '^' || key === '6') key = '\x1e';
    else if (key === '_' || key === '7' || key === '/') key = '\x1f';
    else if (key === '?' || key === '8') key = '\x7f';
    else if (key === '\x7f') key = '\x08';
  }
  return modifiers.alt && data !== '\t' ? '\x1b' + key : key;
}

// Only our own SGR colors may reach xterm. Input is never a PTY byte stream.
export function plainSubagentLog(value: string) {
  return (
    value
      .slice(-16_000)
      .replace(/\r\n?/g, '\n')
      // eslint-disable-next-line no-control-regex -- Strip untrusted terminal controls.
      .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\|$)/g, '')
      // eslint-disable-next-line no-control-regex -- Strip untrusted terminal controls.
      .replace(/\x1b[P^_][\s\S]*?(?:\x1b\\|$)/g, '')
      // eslint-disable-next-line no-control-regex -- Strip untrusted terminal controls.
      .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
      // eslint-disable-next-line no-control-regex -- Keep only safe line feeds and tabs.
      .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, '')
      .replace(/\t/g, '  ')
  );
}

export function styledSubagentLog(value: string) {
  return plainSubagentLog(value)
    .split('\n')
    .map((line) => {
      const color = /^(?:┌─|◆)/.test(line)
        ? '1;38;2;142;186;255'
        : /^└─ ✓|^│ \+/.test(line)
          ? '38;2;131;206;164'
          : /^└─ !|^│ -/.test(line)
            ? '38;2;243;153;153'
            : /^└─ ·/.test(line)
              ? '38;2;220;189;126'
              : /^│ @@|^…/.test(line)
                ? '38;2;142;154;177'
                : '';
      return color ? `\x1b[${color}m${line}\x1b[0m` : line;
    })
    .join('\n');
}

/** Keep output colors, but never allow logs to change clipboard, links, titles or terminal modes. */
export function terminalOutput(value: string) {
  return (
    value
      // eslint-disable-next-line no-control-regex -- Consume terminal string controls including incomplete chunks.
      .replace(/(?:\x1b\]|\x9d)[\s\S]*?(?:\x07|\x1b\\|\x9c|$)/g, '')
      // eslint-disable-next-line no-control-regex
      .replace(/(?:\x1b[P^_]|[\x90\x9e\x9f])[\s\S]*?(?:\x1b\\|\x9c|$)/g, '')
      // eslint-disable-next-line no-control-regex -- Only SGR styling is permitted, not cursor/screen controls.
      .replace(/(?:\x1b\[|\x9b)[0-?]*[ -/]*[@-~]/g, (sequence) =>
        // eslint-disable-next-line no-control-regex -- Accept only color/style sequences.
        /^\x1b\[[\d;:]*m$/.test(sequence) ? sequence : '',
      )
      // eslint-disable-next-line no-control-regex -- Wait until a split escape sequence has completed.
      .replace(/\x1b\[[0-?]*[ -/]*$/g, '')
      // eslint-disable-next-line no-control-regex
      .replace(/\x1b[()][0-~]/g, '')
      // eslint-disable-next-line no-control-regex
      .replace(/\x1b(?!\[[\d;:]*m).?/g, '')
      // eslint-disable-next-line no-control-regex -- Preserve LF, CR and TAB for real line/progress output.
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1a\x1c-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, '')
      .replace(/\[stderr\] /g, '\x1b[33m[stderr]\x1b[0m ')
  );
}

/** Display argv faithfully as a readable command, never execute the formatted string. */
export function terminalCommand(command: string[]) {
  return command
    .map((argument) => {
      const visible = argument.replace(
        // eslint-disable-next-line no-control-regex -- Show controls as text in the command header.
        /[\x00-\x1f\x7f-\x9f]/g,
        (char) => `\\x${char.charCodeAt(0).toString(16).padStart(2, '0')}`,
      );
      return /^[\w./:=@%+,-]+$/.test(visible) ? visible : `'${visible.replace(/'/g, "'\\''")}'`;
    })
    .join(' ');
}

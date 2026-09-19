import test from 'node:test';
import assert from 'node:assert/strict';
import { terminalCommand, terminalOutput } from '../web/src/terminal-log.ts';

test('process output keeps real ANSI colors but blocks terminal controls and handles split sequences', () => {
  assert.equal(terminalOutput('\x1b[32mready\x1b[0m\n'), '\x1b[32mready\x1b[0m\n');
  assert.equal(terminalOutput('before\x1b[31'), 'before');
  assert.equal(terminalOutput('before\x1b[31merror'), 'before\x1b[31merror');
  assert.equal(terminalOutput('10%\r50%\r100%\n'), '10%\r50%\r100%\n');
  const filtered = terminalOutput(
    'keep\x1b]52;c;SECRET\x07\x1b]0;TITLE\x1b\\\x1b[2J\x1b[?1049h\x1bPPRIVATE\x1b\\<b>literal</b>\n',
  );
  assert.equal(filtered, 'keep<b>literal</b>\n');
  assert.equal(terminalOutput('keep\x1b]52;c;INCOMPLETE'), 'keep');
  assert.equal(terminalOutput('keep\x9d52;c;SECRET\x9c'), 'keep');
});

test('command header shows argv boundaries and cannot inject extra prompt lines or colors', () => {
  assert.equal(
    terminalCommand(['npm', 'run', 'dev', '--', '--host', '0.0.0.0']),
    'npm run dev -- --host 0.0.0.0',
  );
  assert.equal(
    terminalCommand(['echo', 'two words', '', "it's"]),
    "echo 'two words' '' 'it'\\''s'",
  );
  const command = terminalCommand(['echo', '\nFAKE\x1b[32m']);
  assert.equal(command.includes('\n') || command.includes('\x1b'), false);
  assert.match(terminalCommand(['echo', '\nFAKE']), /\\x0aFAKE/);
});

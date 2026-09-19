import { setTimeout } from 'node:timers/promises';
import assert from 'node:assert/strict';

// Fixed program: never evaluate, interpolate or execute audience input.
console.log('Pado / workspace checks');
await setTimeout(500);
assert.equal(new Set(['agent', 'terminal', 'docs']).size, 3);
console.log('  ✓ Pane identifiers are unique');
await setTimeout(650);
console.log('  ✓ Presentation events are separate from execution');
await setTimeout(650);
console.error('Rehearsal: no AI request was sent.');
await setTimeout(650);
console.log('  ✓ stdout and stderr are streamed from this process\n');
console.log('3 checks passed · exit 0');

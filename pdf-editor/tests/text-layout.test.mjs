import test from 'node:test';
import assert from 'node:assert/strict';
import { textItemToBlock } from '../src/text-layout.js';

test('text item becomes a baseline anchored editable block', () => {
  const block = textItemToBlock({
    str: 'Hello',
    transform: [1, 0, 0, 1, 120, 220],
    width: 60,
    height: 12,
  }, 1, 0);

  assert.deepEqual(
    { text: block.text, originalText: block.originalText, x: block.x, baseline: block.baseline },
    { text: 'Hello', originalText: 'Hello', x: 120, baseline: 220 },
  );
});

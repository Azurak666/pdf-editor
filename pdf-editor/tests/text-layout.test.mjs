import test from 'node:test';
import assert from 'node:assert/strict';

import { makeBlockFromPdfItem } from '../src/text-layout.js';

test('makeBlockFromPdfItem uses the text item transform for the overlay box', () => {
  const viewport = {
    convertToViewportPoint(x, y) {
      return [x, y];
    },
  };

  const block = makeBlockFromPdfItem({
    str: 'Hello',
    transform: [1, 0, 0, 1, 120, 220],
    width: 60,
    height: 12,
  }, 1, viewport);

  assert.equal(block.pageNumber, 1);
  assert.equal(block.text, 'Hello');
  assert.equal(block.x, 120);
  assert.equal(block.y, 208);
  assert.equal(block.width, 60);
  assert.equal(block.height, 12);
});

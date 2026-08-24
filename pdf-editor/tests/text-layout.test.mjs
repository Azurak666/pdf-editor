import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeTextBlocks, textItemToBlock } from '../src/text-layout.js';
import { sanitizeRichHtml } from '../src/rich-text.js';

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

test('touching fragments on one line become one editable block', () => {
  const blocks = [
    textItemToBlock({ str: 'Jav', transform: [1, 0, 0, 1, 20, 100], width: 16, height: 9 }, 1, 0),
    textItemToBlock({ str: 'aScript, HTML', transform: [1, 0, 0, 1, 36, 100], width: 70, height: 9 }, 1, 1),
  ];

  const merged = mergeTextBlocks(blocks);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].text, 'Jav' + 'aScript, HTML');
  assert.equal(merged[0].width, 86);
});

test('rich text is cleared when normal formatting is restored', () => {
  const html = '<b>Bold</b> and <span style="font-weight:700; color: rgb(0,0,0)">still bold</span>';

  assert.equal(
    sanitizeRichHtml(html, { fontWeight: '400', fontStyle: 'normal', textDecoration: 'none' }),
    'Bold and still bold',
  );
});

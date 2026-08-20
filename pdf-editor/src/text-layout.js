export function textItemToBlock(item, pageNumber, index) {
  if (!item || typeof item.str !== 'string' || !item.str.trim()) return null;

  const transform = Array.isArray(item.transform) ? item.transform : [1, 0, 0, 1, 0, 0];
  const height = Math.max(Number(item.height) || 12, 8);
  const text = item.str.trim();
  const fontName = String(item.fontName || '');
  const inferredWeight = item.fontWeight || (/bold|black|heavy|demi|semibold/i.test(fontName) ? '700' : '400');
  const inferredStyle = item.fontStyle || (/italic|oblique/i.test(fontName) ? 'italic' : 'normal');

  return {
    id: `page-${pageNumber}-text-${index}`,
    pageNumber,
    x: Number(transform[4]) || 0,
    baseline: Number(transform[5]) || 0,
    originalX: Number(transform[4]) || 0,
    originalBaseline: Number(transform[5]) || 0,
    width: Math.max(Number(item.width) || text.length * 6, 8),
    height,
    text,
    originalText: text,
    richHtml: '',
    fontFamily: item.fontFamily || 'sans-serif',
    fontFace: item.fontFace || '',
    fontSize: height,
    fontWeight: inferredWeight,
    fontStyle: inferredStyle,
    textDecoration: 'none',
    fontColor: '#000000',
    originalFontFamily: item.fontFamily || 'sans-serif',
    originalFontSize: height,
    originalFontWeight: inferredWeight,
    originalFontStyle: inferredStyle,
    originalTextDecoration: 'none',
    originalFontColor: '#000000',
    modified: false,
  };
}

export function mergeTextBlocks(blocks) {
  const merged = [];
  const ordered = [...blocks].sort((left, right) => (
    left.pageNumber - right.pageNumber
    || right.baseline - left.baseline
    || left.x - right.x
  ));

  ordered.forEach((block) => {
    const previous = merged[merged.length - 1];
    const sameLine = previous
      && previous.pageNumber === block.pageNumber
      && Math.abs(previous.baseline - block.baseline) <= 1
      && Math.abs(previous.fontSize - block.fontSize) <= 1
      && previous.fontFamily === block.fontFamily
      && previous.fontWeight === block.fontWeight
      && previous.fontStyle === block.fontStyle
      && block.x - (previous.x + previous.width) <= Math.max(1, block.fontSize * 0.08)
      && block.x >= previous.x;

    if (!sameLine) {
      merged.push(block);
      return;
    }

    previous.text += block.text;
    previous.originalText += block.originalText;
    previous.width = block.x + block.width - previous.x;
  });

  return merged;
}

export function blockRectangle(viewport, block) {
  const [x1, y1] = viewport.convertToViewportPoint(block.x, block.baseline);
  const [x2, y2] = viewport.convertToViewportPoint(
    block.x + block.width,
    block.baseline + block.height,
  );

  return {
    left: Math.min(x1, x2),
    top: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  };
}

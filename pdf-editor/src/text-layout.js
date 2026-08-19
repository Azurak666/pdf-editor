export function textItemToBlock(item, pageNumber, index) {
  if (!item || typeof item.str !== 'string' || !item.str.trim()) return null;

  const transform = Array.isArray(item.transform) ? item.transform : [1, 0, 0, 1, 0, 0];
  const height = Math.max(Number(item.height) || 12, 8);
  const text = item.str.trim();
  const fontName = String(item.fontName || '');

  return {
    id: `page-${pageNumber}-text-${index}`,
    pageNumber,
    x: Number(transform[4]) || 0,
    baseline: Number(transform[5]) || 0,
    width: Math.max(Number(item.width) || text.length * 6, 8),
    height,
    text,
    originalText: text,
    fontFamily: item.fontFamily || 'sans-serif',
    fontSize: height,
    fontWeight: /bold|black|heavy/i.test(fontName) ? '700' : '400',
    fontStyle: /italic|oblique/i.test(fontName) ? 'italic' : 'normal',
  };
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

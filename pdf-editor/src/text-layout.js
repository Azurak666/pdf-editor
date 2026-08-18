export function normalizePdfTextItems(items = []) {
  return (items || [])
    .filter((item) => item && typeof item.str === 'string' && item.str.trim())
    .map((item) => {
      const transform = Array.isArray(item.transform) ? item.transform : [1, 0, 0, 1, 0, 0];
      const x = Number(transform[4]) || 0;
      const y = Number(transform[5]) || 0;
      const width = Number(item.width) || Math.max(8, item.str.length * 6);
      const height = Number(item.height) || 12;

      return {
        ...item,
        str: String(item.str).trim(),
        x,
        y,
        width: Math.max(width, 8),
        height: Math.max(height, 8),
        left: x,
        top: y - height,
        right: x + width,
        bottom: y,
      };
    });
}

export function makeBlockFromPdfItem(item, pageNumber, index = 0) {
  if (!item || !item.str) return null;

  const transform = Array.isArray(item.transform) ? item.transform : [1, 0, 0, 1, 0, 0];
  
  // item.y from normalizePdfTextItems is transform[5] (PDF.js baseline)
  // We need to get the TOP of the text box for positioning
  // If item.y is already adjusted (y - height from main.js), use it
  // Otherwise, calculate it from transform
  let x, y;
  
  if (typeof item.y === 'number' && item.y !== undefined) {
    // Use the y passed in (should already account for height)
    x = item.x ?? Number(transform[4]) ?? 0;
    y = item.y; // Already top position
  } else {
    // Fallback: calculate from transform directly
    x = Number(transform[4]) ?? 0;
    const baseline = Number(transform[5]) ?? 0;
    y = baseline - (Number(item.height) || 12);
  }
  
  const width = Number(item.width) || Math.max(8, item.str.length * 6);
  const height = Number(item.height) || 12;

  return {
    id: `page-${pageNumber}-block-${index}`,
    pageNumber,
    x,
    y, // TOP of box in PDF space
    width: Math.max(width, 8),
    height: Math.max(height, 8),
    text: String(item.str).trim(),
  };
}

export function detectTextBlockAtPoint(items, pageNumber, pointX, pointY) {
  const words = normalizePdfTextItems(items);
  if (!words.length) return null;

  let closest = null;

  words.forEach((word, index) => {
    const left = word.left;
    const right = word.right;
    const top = word.top;
    const bottom = word.bottom;
    const withinX = pointX >= left && pointX <= right;
    const withinY = pointY >= top && pointY <= bottom;
    const dx = Math.max(0, Math.abs(pointX - ((left + right) / 2)) - word.width / 2);
    const dy = Math.max(0, Math.abs(pointY - ((top + bottom) / 2)) - word.height / 2);
    const distance = Math.hypot(dx, dy);

    if (withinX && withinY) {
      if (!closest || distance < closest.distance) {
        closest = { word, distance, index };
      }
    } else if (distance <= 12) {
      if (!closest || distance < closest.distance) {
        closest = { word, distance, index };
      }
    }
  });

  if (!closest) return null;

  return makeBlockFromPdfItem(
    {
      ...closest.word,
      x: closest.word.x,
      y: closest.word.y - closest.word.height,
      width: closest.word.width,
      height: closest.word.height,
    },
    pageNumber,
    closest.index,
  );
}

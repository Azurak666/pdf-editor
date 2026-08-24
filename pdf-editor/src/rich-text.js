export function sanitizeRichHtml(html, state = {}) {
  const value = typeof html === 'string' ? html : '';
  if (!value.trim()) return '';

  const normalized = value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(b|strong|u|i|em|font|span)[^>]*>/gi, '')
    .replace(/style\s*=\s*"[^"]*"/gi, '')
    .replace(/style\s*=\s*'[^']*'/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\u00a0/g, ' ')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]*\n[ \t]*/g, '\n');

  const plainText = normalized.trim();

  if (state.fontWeight === '400' || state.fontStyle === 'normal' || state.textDecoration === 'none') {
    return plainText;
  }

  return plainText;
}

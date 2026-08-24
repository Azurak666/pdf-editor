import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import mupdf from 'mupdf';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import poppinsRegularUrl from '@fontsource/poppins/files/poppins-latin-400-normal.woff2?url';
import poppinsBoldUrl from '@fontsource/poppins/files/poppins-latin-700-normal.woff2?url';
import poppinsItalicUrl from '@fontsource/poppins/files/poppins-latin-400-italic.woff2?url';
import poppinsBoldItalicUrl from '@fontsource/poppins/files/poppins-latin-700-italic.woff2?url';
import '@fontsource/poppins/400.css';
import '@fontsource/poppins/700.css';
import './styles.css';
import { blockRectangle, mergeTextBlocks, textItemToBlock } from './text-layout.js';
import { sanitizeRichHtml } from './rich-text.js';

GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

const $ = (id) => document.getElementById(id);
const input = $('pdf-input');
const save = $('save-button');
const undoButton = $('undo-button');
const redoButton = $('redo-button');
const addTextButton = $('add-text-button');
const apply = $('apply-button');
const deleteButton = $('delete-button');
const textValue = $('text-value');
const fontFamily = $('font-family');
const fontSize = $('font-size');
const boldButton = $('bold-button');
const italicButton = $('italic-button');
const underlineButton = $('underline-button');
const fontColor = $('font-color');
const status = $('status');
const pageInner = $('page-inner');
const pdfCanvas = $('pdf-canvas');
const maskCanvas = $('mask-canvas');
const textLayer = $('text-layer');
const selectionBox = $('selection-box');
const documentTitle = $('document-title');
const pageCount = $('page-count');
const inspectorEyebrow = $('inspector-eyebrow');
const inspectorTitle = $('inspector-title');
const fontBytesCache = new Map();

const state = { pdf: null, sourceBytes: null, page: null, viewport: null, blocks: [], selected: -1, selectedIndices: new Set(), selecting: false, selectionStart: null, selectionEnd: null, history: [], future: [], activeEditor: null, addingText: false, draggingBlock: -1, dragStart: null, dragOrigin: null, dragTarget: null, dragMoved: false };

function setStatus(message) { status.textContent = message; }
function selectedBlock() { return state.blocks[state.selected]; }
function selectedBlocks() { return [...state.selectedIndices].map((index) => state.blocks[index]).filter(Boolean); }

function syncModified(block) {
  if (block.isNew) {
    block.modified = Boolean(block.text);
    return;
  }
  block.modified = block.text !== block.originalText
    || block.fontFamily !== block.originalFontFamily
    || block.fontSize !== block.originalFontSize
    || block.fontWeight !== block.originalFontWeight
    || block.fontStyle !== block.originalFontStyle
    || block.textDecoration !== block.originalTextDecoration
    || block.fontColor !== block.originalFontColor
    || block.x !== block.originalX
    || block.baseline !== block.originalBaseline
    || Boolean(block.richHtml?.match(/<[^>]+>/));
}

function snapshot() { return JSON.stringify(state.blocks); }

function recordHistory() {
  const current = snapshot();
  if (state.history[state.history.length - 1] !== current) state.history.push(current);
  state.future = [];
}

function undo() {
  if (state.history.length < 2) return;
  state.future.push(state.history.pop());
  state.blocks = JSON.parse(state.history[state.history.length - 1]);
  renderTextLayer();
  syncInspector();
}

function redo() {
  const next = state.future.pop();
  if (!next) return;
  state.history.push(next);
  state.blocks = JSON.parse(next);
  renderTextLayer();
  syncInspector();
}

function syncInspector() {
  const block = selectedBlock();
  const blocks = selectedBlocks();
  const addMode = state.addingText;
  inspectorEyebrow.textContent = addMode ? 'Add text' : 'Properties';
  inspectorTitle.textContent = addMode ? 'Add text' : 'Edit text';
  apply.textContent = addMode ? 'Place text on page' : 'Apply changes';
  textValue.placeholder = addMode ? 'Type text after placing it' : 'Select text in the PDF';
  textValue.value = block?.text || '';
  fontFamily.value = block?.fontFamily || (addMode ? 'Poppins' : 'sans-serif');
  fontSize.value = block?.fontSize || (addMode ? 12 : '');
  fontColor.value = block?.fontColor || '#000000';
  boldButton.classList.toggle('active', blocks.length > 0 && blocks.every((item) => item.fontWeight === '700'));
  italicButton.classList.toggle('active', blocks.length > 0 && blocks.every((item) => item.fontStyle === 'italic'));
  underlineButton.classList.toggle('active', blocks.length > 0 && blocks.every((item) => item.textDecoration === 'underline'));
}

function selectBlock(index) {
  state.addingText = false;
  addTextButton.classList.remove('active');
  state.selected = index;
  state.selectedIndices = index >= 0 ? new Set([index]) : new Set();
  syncInspector();
  renderTextLayer();
}

function toggleAddText() {
  if (!state.pdf) {
    setStatus('Open a PDF before adding text.');
    return;
  }
  state.addingText = !state.addingText;
  addTextButton.classList.toggle('active', state.addingText);
  syncInspector();
  setStatus(state.addingText ? 'Click on the page to place text.' : 'Text placement cancelled.');
}

function deleteSelected() {
  const blocks = selectedBlocks();
  if (!blocks.length) {
    setStatus('Select text before deleting.');
    return;
  }
  recordHistory();
  blocks.forEach((block) => {
    if (block.isNew) {
      state.blocks = state.blocks.filter((item) => item !== block);
      return;
    }
    block.text = '';
    block.richHtml = '';
    block.deleted = true;
    block.modified = true;
  });
  state.selected = -1;
  state.selectedIndices = new Set();
  state.activeEditor = null;
  syncInspector();
  renderTextLayer();
  setStatus(`${blocks.length} text item${blocks.length === 1 ? '' : 's'} deleted.`);
}

function startBlockDrag(event, index, target) {
  if (event.button !== 0 || state.addingText) return;
  state.selected = index;
  state.selectedIndices = new Set([index]);
  syncInspector();
  state.draggingBlock = index;
  state.dragStart = { x: event.clientX, y: event.clientY };
  state.dragOrigin = { x: state.blocks[index].x, baseline: state.blocks[index].baseline };
  state.dragTarget = target;
  state.dragMoved = false;
  event.stopPropagation();
  event.preventDefault();
}

function createTextAt(event) {
  if (!state.viewport) return;
  const rect = pageInner.getBoundingClientRect();
  const screenX = event.clientX - rect.left;
  const screenY = event.clientY - rect.top;
  const selectedFontSize = Math.max(6, Number(fontSize.value) || 12);
  const [x, top] = state.viewport.convertToPdfPoint(screenX, screenY);
  const block = {
    id: `page-1-added-${Date.now()}`,
    pageNumber: 1,
    x,
    baseline: top - selectedFontSize,
    originalX: x,
    originalBaseline: top - fontSize,
    width: 120,
    height: selectedFontSize,
    text: '',
    originalText: '',
    richHtml: '',
    fontFamily: fontFamily.value || 'Poppins',
    fontFace: '',
    fontSize: selectedFontSize,
    fontWeight: boldButton.classList.contains('active') ? '700' : '400',
    fontStyle: italicButton.classList.contains('active') ? 'italic' : 'normal',
    textDecoration: underlineButton.classList.contains('active') ? 'underline' : 'none',
    fontColor: fontColor.value || '#000000',
    isNew: true,
    modified: true,
  };
  recordHistory();
  state.blocks.push(block);
  state.addingText = false;
  addTextButton.classList.remove('active');
  setStatus('Type text, then apply the change.');
  state.selected = state.blocks.length - 1;
  state.selectedIndices = new Set([state.selected]);
  syncInspector();
  renderTextLayer();
  event.preventDefault();
  event.stopPropagation();
}

function makeEditor(block, index, box, maskContext) {
  paintMask(maskContext, box);

  const wrapper = document.createElement('div');
  wrapper.className = 'inline-editor-wrapper';
  wrapper.style.left = `${box.left}px`;
  wrapper.style.top = `${box.top + editorLeading(block)}px`;
  wrapper.style.width = `${Math.max(box.width, 12)}px`;
  wrapper.style.height = `${Math.max(box.height, 12)}px`;

  const editor = document.createElement('div');
  editor.className = 'inline-editor';
  editor.contentEditable = 'true';
  editor.spellcheck = false;
  editor.style.fontFamily = cssFontFamily(block);
  editor.style.fontSize = `${Math.max(block.fontSize * state.viewport.scale, 8)}px`;
  editor.style.fontWeight = block.fontWeight;
  editor.style.fontStyle = block.fontStyle;
  editor.style.textDecoration = block.textDecoration || 'none';
  editor.style.color = block.fontColor || '#000000';

  const run = document.createElement('span');
  run.className = 'edit-run';
  if (block.richHtml) run.innerHTML = block.richHtml;
  else run.textContent = block.text;
  run.dataset.runIndex = '0';
  run.dataset.origWeight = block.fontWeight;
  run.dataset.origItalic = block.fontStyle === 'italic' ? 'true' : '';
  run.dataset.origUnderline = '';
  editor.appendChild(run);
  editor.addEventListener('input', () => {
    block.text = editor.textContent || '';
    block.richHtml = editor.innerHTML;
    syncModified(block);
    syncInspector();
  });
  editor.addEventListener('beforeinput', (event) => {
    if (event.inputType?.startsWith('insert') || event.inputType?.startsWith('delete')) recordHistory();
  });
  wrapper.appendChild(editor);
  textLayer.appendChild(wrapper);
  state.activeEditor = editor;
  requestAnimationFrame(() => editor.focus());
}

function makeEditedText(block, box, maskContext) {
  paintMask(maskContext, box);

  const replacement = document.createElement('div');
  replacement.className = 'edited-text';
  replacement.innerHTML = block.richHtml || block.text;
  replacement.style.left = `${box.left}px`;
  replacement.style.top = `${box.top + editorLeading(block)}px`;
  replacement.style.width = `${Math.max(box.width, 12)}px`;
  replacement.style.height = `${Math.max(box.height, 12)}px`;
  replacement.style.fontFamily = cssFontFamily(block);
  replacement.style.fontSize = `${Math.max(block.fontSize * state.viewport.scale, 8)}px`;
  replacement.style.fontWeight = block.fontWeight;
  replacement.style.fontStyle = block.fontStyle;
  replacement.style.textDecoration = block.textDecoration || 'none';
  replacement.style.color = block.fontColor || '#000000';
  textLayer.appendChild(replacement);
}

function editorLeading(block) {
  const fontSize = Math.max(block.fontSize * state.viewport.scale, 8);
  return fontSize * (1.219 - 1) / 2;
}

function paintMask(context, box) {
  const horizontalBleed = 3;
  const topBleed = 1;
  const bottomBleed = 6;
  context.fillStyle = '#fff';
  context.fillRect(
    box.left - horizontalBleed,
    box.top - topBleed,
    box.width + horizontalBleed * 2,
    box.height + topBleed + bottomBleed,
  );
}

function cssFontFamily(block) {
  if (block.fontFamily === 'Poppins') return 'Poppins';
  const fallback = block.fontFamily || 'sans-serif';
  return block.fontFace ? `"${block.fontFace}", ${fallback}, sans-serif` : `${fallback}, sans-serif`;
}

function renderTextLayer() {
  textLayer.replaceChildren();
  textLayer.appendChild(selectionBox);
  state.activeEditor = null;
  const maskContext = maskCanvas.getContext('2d');
  maskContext.clearRect(0, 0, maskCanvas.width, maskCanvas.height);

  state.blocks.forEach((block, index) => {
    const box = blockRectangle(state.viewport, block);
    if (block.deleted) {
      paintMask(maskContext, box);
      return;
    }
    const isEditing = index === state.selected && state.selectedIndices.size === 1;
    const target = document.createElement('div');
    target.className = 'text-target';
    if (state.selectedIndices.has(index)) target.classList.add('selected');
    target.title = `${block.text} Click to edit`;
    target.style.left = `${box.left}px`;
    target.style.top = `${box.top}px`;
    target.style.width = `${Math.max(box.width, 12)}px`;
    target.style.height = `${Math.max(box.height, 12)}px`;
    target.addEventListener('click', (event) => {
      event.stopPropagation();
      selectBlock(index);
    });
    target.addEventListener('pointerdown', (event) => {
      if (state.addingText) createTextAt(event);
      else startBlockDrag(event, index, target);
    });
    if (!isEditing) textLayer.appendChild(target);
    if (isEditing) {
      makeEditor(block, index, box, maskContext);
    } else if (block.modified) {
      makeEditedText(block, box, maskContext);
    }
  });
}

function finishMarquee() {
  const start = state.selectionStart;
  if (!start) return;
  const left = Math.min(start.x, state.selectionEnd.x);
  const top = Math.min(start.y, state.selectionEnd.y);
  const right = Math.max(start.x, state.selectionEnd.x);
  const bottom = Math.max(start.y, state.selectionEnd.y);
  state.selectedIndices = new Set();
  state.blocks.forEach((block, index) => {
    const box = blockRectangle(state.viewport, block);
    if (box.left < right && box.left + box.width > left && box.top < bottom && box.top + box.height > top) {
      state.selectedIndices.add(index);
    }
  });
  state.selected = state.selectedIndices.size === 1 ? [...state.selectedIndices][0] : -1;
  selectionBox.hidden = true;
  state.selecting = false;
  setStatus(`${state.selectedIndices.size} text item${state.selectedIndices.size === 1 ? '' : 's'} selected.`);
  syncInspector();
  renderTextLayer();
}

async function openPdf(file) {
  if (!file) return;
  try {
    state.sourceBytes = new Uint8Array(await file.arrayBuffer());
    state.pdf = await getDocument({ data: state.sourceBytes.slice() }).promise;
    state.page = await state.pdf.getPage(1);
    state.viewport = state.page.getViewport({ scale: Math.min(2, 1000 / state.page.getViewport({ scale: 1 }).width) });
    state.selected = -1;
    state.history = [];
    state.future = [];
    documentTitle.textContent = file.name;
    pageCount.textContent = `${state.pdf.numPages} page${state.pdf.numPages === 1 ? '' : 's'}`;

    pdfCanvas.width = state.viewport.width;
    pdfCanvas.height = state.viewport.height;
    maskCanvas.width = state.viewport.width;
    maskCanvas.height = state.viewport.height;
    pageInner.style.width = `${state.viewport.width}px`;
    pageInner.style.height = `${state.viewport.height}px`;
    await state.page.render({ canvasContext: pdfCanvas.getContext('2d'), viewport: state.viewport }).promise;
    const content = await state.page.getTextContent();
    state.blocks = mergeTextBlocks(content.items.map((item, index) => textItemToBlock({
      ...item,
      fontFamily: content.styles?.[item.fontName]?.fontFamily,
      ...fontMetadata(state.page, item),
    }, 1, index)).filter(Boolean));
    state.history.push(snapshot());
    renderTextLayer();
    setStatus(`${state.blocks.length} text items loaded.`);
  } catch (error) {
    console.error(error);
    setStatus('PDF could not be opened.');
    alert(`Unable to read the PDF file: ${error.message}`);
  }
}

function fontMetadata(page, item) {
  try {
    const commonObjects = page.commonObjs;
    const font = commonObjects?.has?.(item.fontName) ? commonObjects.get(item.fontName) : null;
    if (!font) return {};

    const fontFamily = /poppins/i.test(font.name || '') ? 'Poppins' : font.fallbackName || font.name;
    const fontDescriptor = `${font.name || ''} ${font.fallbackName || ''}`;

    return {
      fontWeight: font.bold || font.black || font.weight >= 700 || /bold|black|heavy|demi|semibold/i.test(fontDescriptor) ? '700' : '400',
      fontStyle: font.italic || font.style === 'italic' ? 'italic' : 'normal',
      fontFamily,
      fontFace: font.loadedName || '',
    };
  } catch {
    return {};
  }
}

async function downloadPdf() {
  if (!state.pdf || !state.sourceBytes) {
    setStatus('Open a PDF before downloading.');
    return;
  }

  try {
    setStatus('Preparing PDF download...');
    const redactedBytes = await redactEditedText(state.sourceBytes);
    const output = await PDFDocument.load(redactedBytes);
    output.registerFontkit(fontkit);
    for (const block of state.blocks) {
      if (!block.modified) continue;
      const page = output.getPages()[block.pageNumber - 1];
      if (block.text) await drawRichText(page, output, block);
    }
    const url = URL.createObjectURL(new Blob([await output.save()], { type: 'application/pdf' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'edited-document.pdf';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus('PDF downloaded.');
  } catch (error) {
    console.error(error);
    setStatus('PDF could not be downloaded.');
    alert(`Unable to create the PDF download: ${error.message}`);
  }
}

async function redactEditedText(sourceBytes) {
  const document = mupdf.Document.openDocument(sourceBytes);
  const redactionsByPage = new Map();
  state.blocks.filter((block) => block.modified).forEach((block) => {
    if (!redactionsByPage.has(block.pageNumber - 1)) redactionsByPage.set(block.pageNumber - 1, []);
    redactionsByPage.get(block.pageNumber - 1).push(block);
  });

  redactionsByPage.forEach((blocks, pageNumber) => {
    const page = document.loadPage(pageNumber);
    const boundsByText = getMuPdfTextBounds(page);
    blocks.forEach((block) => {
      const bounds = boundsByText.get(block.originalText);
      if (!bounds) return;
      const redaction = page.createAnnotation('Redact');
      redaction.setRect([bounds[0] - 1, bounds[1] - 1, bounds[2] + 1, bounds[3] + 1]);
      redaction.update();
    });
    page.applyRedactions(false, mupdf.PDFPage.REDACT_IMAGE_NONE, mupdf.PDFPage.REDACT_LINE_ART_NONE, mupdf.PDFPage.REDACT_TEXT_REMOVE);
    page.update();
  });

  const result = document.saveToBuffer({ garbage: 4 }).asUint8Array();
  document.destroy();
  return result;
}

function getMuPdfTextBounds(page) {
  const bounds = new Map();
  let currentLine = '';
  let currentBounds = null;
  page.toStructuredText().walk({
    beginLine: () => {
      currentLine = '';
      currentBounds = null;
    },
    onChar: (character, origin, font, size, quad) => {
      currentLine += character;
      const points = [quad[0], quad[1], quad[2], quad[3], quad[4], quad[5], quad[6], quad[7]];
      const charBounds = [Math.min(points[0], points[2], points[4], points[6]), Math.min(points[1], points[3], points[5], points[7]), Math.max(points[0], points[2], points[4], points[6]), Math.max(points[1], points[3], points[5], points[7])];
      currentBounds = currentBounds ? [Math.min(currentBounds[0], charBounds[0]), Math.min(currentBounds[1], charBounds[1]), Math.max(currentBounds[2], charBounds[2]), Math.max(currentBounds[3], charBounds[3])] : charBounds;
    },
    endLine: () => {
      if (currentLine && currentBounds) bounds.set(currentLine, currentBounds);
    },
  });
  return bounds;
}

async function drawRichText(page, output, block) {
  const runs = block.richHtml ? extractRichRuns(block) : [{
    text: block.text,
    fontWeight: block.fontWeight,
    fontStyle: block.fontStyle,
    textDecoration: block.textDecoration,
    fontSize: block.fontSize,
    fontFamily: block.fontFamily,
    fontColor: block.fontColor,
  }];
  let x = block.x;
  for (const run of runs) {
    if (!run.text) continue;
    const font = await output.embedFont(await exportFont({ ...block, ...run }));
    const color = hexColor(run.fontColor || block.fontColor);
    page.drawText(run.text, { x, y: block.baseline, size: run.fontSize || block.fontSize, font, color });
    const width = font.widthOfTextAtSize(run.text, run.fontSize || block.fontSize);
    if (run.textDecoration === 'underline') {
      page.drawLine({
        start: { x, y: block.baseline - (run.fontSize || block.fontSize) * 0.12 },
        end: { x: x + width, y: block.baseline - (run.fontSize || block.fontSize) * 0.12 },
        thickness: Math.max(0.5, (run.fontSize || block.fontSize) * 0.04),
        color,
      });
    }
    x += width;
  }
}

function extractRichRuns(block) {
  const root = document.createElement('div');
  root.innerHTML = block.richHtml;
  const runs = [];
  const walk = (node, inherited) => {
    if (node.nodeType === Node.TEXT_NODE) {
      runs.push({ ...inherited, text: node.nodeValue });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const style = node.style;
    const next = {
      ...inherited,
      fontWeight: node.matches('b,strong') || style.fontWeight === 'bold' || style.fontWeight === '700' ? '700' : style.fontWeight === 'normal' || style.fontWeight === '400' ? '400' : inherited.fontWeight,
      fontStyle: node.matches('i,em') || style.fontStyle === 'italic' ? 'italic' : style.fontStyle === 'normal' ? 'normal' : inherited.fontStyle,
      textDecoration: node.matches('u') || style.textDecoration === 'underline' ? 'underline' : style.textDecoration === 'none' ? 'none' : inherited.textDecoration,
      fontSize: Number.parseFloat(style.fontSize) || inherited.fontSize,
      fontFamily: style.fontFamily?.replaceAll('"', '') || inherited.fontFamily,
      fontColor: style.color || inherited.fontColor,
    };
    node.childNodes.forEach((child) => walk(child, next));
  };
  root.childNodes.forEach((child) => walk(child, block));
  return runs;
}

async function exportFont(block) {
  if (block.fontFamily === 'Poppins') return loadPoppinsFont(block);
  if (block.fontFamily === 'Times New Roman') {
    if (block.fontWeight === '700' && block.fontStyle === 'italic') return StandardFonts.TimesRomanBoldItalic;
    if (block.fontWeight === '700') return StandardFonts.TimesRomanBold;
    if (block.fontStyle === 'italic') return StandardFonts.TimesRomanItalic;
    return StandardFonts.TimesRoman;
  }
  if (block.fontFamily === 'Courier New') {
    if (block.fontWeight === '700' && block.fontStyle === 'italic') return StandardFonts.CourierBoldOblique;
    if (block.fontWeight === '700') return StandardFonts.CourierBold;
    if (block.fontStyle === 'italic') return StandardFonts.CourierOblique;
    return StandardFonts.Courier;
  }
  if (block.fontWeight === '700' && block.fontStyle === 'italic') return StandardFonts.HelveticaBoldOblique;
  if (block.fontWeight === '700') return StandardFonts.HelveticaBold;
  if (block.fontStyle === 'italic') return StandardFonts.HelveticaOblique;
  return StandardFonts.Helvetica;
}

async function loadPoppinsFont(block) {
  const variant = block.fontWeight === '700'
    ? block.fontStyle === 'italic' ? 'bold-italic' : 'bold'
    : block.fontStyle === 'italic' ? 'italic' : 'regular';
  if (!fontBytesCache.has(variant)) {
    const url = {
      regular: poppinsRegularUrl,
      bold: poppinsBoldUrl,
      italic: poppinsItalicUrl,
      'bold-italic': poppinsBoldItalicUrl,
    }[variant];
    fontBytesCache.set(variant, fetch(url).then((response) => response.arrayBuffer()));
  }
  return fontBytesCache.get(variant);
}

function hexColor(value = '#000000') {
  if (value.startsWith('rgb')) {
    const channels = value.match(/[\d.]+/g)?.map(Number) || [];
    return rgb((channels[0] || 0) / 255, (channels[1] || 0) / 255, (channels[2] || 0) / 255);
  }
  const hex = value.replace('#', '');
  const red = Number.parseInt(hex.slice(0, 2), 16) / 255;
  const green = Number.parseInt(hex.slice(2, 4), 16) / 255;
  const blue = Number.parseInt(hex.slice(4, 6), 16) / 255;
  return rgb(red || 0, green || 0, blue || 0);
}

input.addEventListener('change', (event) => openPdf(event.target.files?.[0]));
save.addEventListener('click', downloadPdf);
undoButton.addEventListener('click', undo);
redoButton.addEventListener('click', redo);
addTextButton.addEventListener('click', toggleAddText);
deleteButton.addEventListener('click', deleteSelected);
apply.addEventListener('click', () => {
  if (!selectedBlocks().length) return;
  recordHistory();
  selectedBlocks().forEach((item) => {
    item.text = textValue.value;
    syncModified(item);
  });
  renderTextLayer();
});
function updateSelectedStyle(property, value) {
  if (formatActiveEditor(property, value)) return;
  const blocks = selectedBlocks();
  if (!blocks.length) return;
  recordHistory();
  blocks.forEach((block) => {
    block[property] = value;
    if (property === 'fontWeight' && value === '400') {
      block.richHtml = sanitizeRichHtml(block.richHtml || block.text, {
        fontWeight: '400',
        fontStyle: block.fontStyle,
        textDecoration: block.textDecoration,
        fontSize: block.fontSize,
        fontFamily: block.fontFamily,
        fontColor: block.fontColor,
      });
    }
    if (property === 'fontStyle' && value === 'normal') {
      block.richHtml = sanitizeRichHtml(block.richHtml || block.text, {
        fontWeight: block.fontWeight,
        fontStyle: 'normal',
        textDecoration: block.textDecoration,
        fontSize: block.fontSize,
        fontFamily: block.fontFamily,
        fontColor: block.fontColor,
      });
    }
    if (property === 'textDecoration' && value === 'none') {
      block.richHtml = sanitizeRichHtml(block.richHtml || block.text, {
        fontWeight: block.fontWeight,
        fontStyle: block.fontStyle,
        textDecoration: 'none',
        fontSize: block.fontSize,
        fontFamily: block.fontFamily,
        fontColor: block.fontColor,
      });
    }
    syncModified(block);
  });
  syncInspector();
  renderTextLayer();
}

function formatActiveEditor(property, value) {
  const editor = state.activeEditor;
  const selection = window.getSelection();
  if (!editor || !selection?.rangeCount || selection.isCollapsed || !editor.contains(selection.anchorNode)) return false;

  const command = {
    fontWeight: 'bold',
    fontStyle: 'italic',
    textDecoration: 'underline',
    fontFamily: 'fontName',
    fontColor: 'foreColor',
    fontSize: 'fontSize',
  }[property];
  if (!command) return false;

  recordHistory();
  document.execCommand(command, false, property === 'fontSize' ? '7' : property === 'fontFamily' ? value : undefined);
  if (property === 'fontSize') {
    const fonts = editor.querySelectorAll('font[size="7"]');
    fonts.forEach((font) => {
      font.removeAttribute('size');
      font.style.fontSize = `${value}px`;
    });
  }
  const block = selectedBlock();
  if (block) {
    block.text = editor.textContent || '';
    block.richHtml = sanitizeRichHtml(editor.innerHTML, {
      fontWeight: block.fontWeight,
      fontStyle: block.fontStyle,
      textDecoration: block.textDecoration,
      fontSize: block.fontSize,
      fontFamily: block.fontFamily,
      fontColor: block.fontColor,
    });
    syncModified(block);
  }
  return true;
}
fontFamily.addEventListener('change', () => updateSelectedStyle('fontFamily', fontFamily.value));
fontSize.addEventListener('change', () => updateSelectedStyle('fontSize', Math.max(6, Number(fontSize.value) || 12)));
function toggleSelectedStyle(property, activeValue, inactiveValue) {
  const blocks = selectedBlocks();
  if (!blocks.length) return;
  const allActive = blocks.every((block) => block[property] === activeValue);
  updateSelectedStyle(property, allActive ? inactiveValue : activeValue);
}
boldButton.addEventListener('click', () => toggleSelectedStyle('fontWeight', '700', '400'));
italicButton.addEventListener('click', () => toggleSelectedStyle('fontStyle', 'italic', 'normal'));
underlineButton.addEventListener('click', () => toggleSelectedStyle('textDecoration', 'underline', 'none'));
fontColor.addEventListener('input', () => updateSelectedStyle('fontColor', fontColor.value));
window.addEventListener('keydown', (event) => {
  if (!(event.ctrlKey || event.metaKey)) return;
  const key = event.key.toLowerCase();
  if (key === 'z') {
    event.preventDefault();
    event.shiftKey ? redo() : undo();
  } else if (key === 'y') {
    event.preventDefault();
    redo();
  }
});
textLayer.addEventListener('pointerdown', (event) => {
  if (state.addingText) {
    createTextAt(event);
    return;
  }
  if (event.target !== textLayer) return;
  const rect = pageInner.getBoundingClientRect();
  state.selecting = true;
  state.selectionStart = { x: event.clientX - rect.left, y: event.clientY - rect.top };
  state.selectionEnd = state.selectionStart;
  selectionBox.hidden = false;
  selectionBox.style.left = `${state.selectionStart.x}px`;
  selectionBox.style.top = `${state.selectionStart.y}px`;
  selectionBox.style.width = '0px';
  selectionBox.style.height = '0px';
  event.preventDefault();
});

document.addEventListener('pointermove', (event) => {
  if (state.draggingBlock >= 0) {
    const block = state.blocks[state.draggingBlock];
    if (!block || !state.dragTarget || !state.viewport) return;
    const scale = state.viewport.scale;
    const deltaX = (event.clientX - state.dragStart.x) / scale;
    const deltaY = (event.clientY - state.dragStart.y) / scale;
    state.dragMoved = Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2;
    block.x = state.dragOrigin.x + deltaX;
    block.baseline = state.dragOrigin.baseline - deltaY;
    syncModified(block);
    const box = blockRectangle(state.viewport, block);
    state.dragTarget.style.left = `${box.left}px`;
    state.dragTarget.style.top = `${box.top}px`;
    return;
  }
  if (!state.selecting) return;
  const rect = pageInner.getBoundingClientRect();
  state.selectionEnd = { x: event.clientX - rect.left, y: event.clientY - rect.top };
  const left = Math.min(state.selectionStart.x, state.selectionEnd.x);
  const top = Math.min(state.selectionStart.y, state.selectionEnd.y);
  selectionBox.style.left = `${left}px`;
  selectionBox.style.top = `${top}px`;
  selectionBox.style.width = `${Math.abs(state.selectionEnd.x - state.selectionStart.x)}px`;
  selectionBox.style.height = `${Math.abs(state.selectionEnd.y - state.selectionStart.y)}px`;
});

document.addEventListener('pointerup', () => {
  if (state.draggingBlock >= 0) {
    if (state.dragMoved) recordHistory();
    state.draggingBlock = -1;
    state.dragStart = null;
    state.dragOrigin = null;
    state.dragTarget = null;
    state.dragMoved = false;
    renderTextLayer();
    return;
  }
  if (state.selecting) finishMarquee();
});

pdfCanvas.addEventListener('click', () => selectBlock(-1));
window.addEventListener('keydown', (event) => {
  if (event.key === 'Delete' && document.activeElement !== textValue && document.activeElement?.contentEditable !== 'true') {
    event.preventDefault();
    deleteSelected();
  }
});

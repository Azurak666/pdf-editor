import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import './styles.css';
import { blockRectangle, textItemToBlock } from './text-layout.js';

GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

const $ = (id) => document.getElementById(id);
const input = $('pdf-input');
const save = $('save-button');
const apply = $('apply-button');
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

const state = { pdf: null, sourceBytes: null, page: null, viewport: null, blocks: [], selected: -1, selectedIndices: new Set(), selecting: false, selectionStart: null, selectionEnd: null, history: [], future: [], activeEditor: null };

function setStatus(message) { status.textContent = message; }
function selectedBlock() { return state.blocks[state.selected]; }
function selectedBlocks() { return [...state.selectedIndices].map((index) => state.blocks[index]).filter(Boolean); }

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
  textValue.value = block?.text || '';
  fontFamily.value = block?.fontFamily || 'sans-serif';
  fontSize.value = block?.fontSize || '';
  fontColor.value = block?.fontColor || '#000000';
  boldButton.classList.toggle('active', blocks.length > 0 && blocks.every((item) => item.fontWeight === '700'));
  italicButton.classList.toggle('active', blocks.length > 0 && blocks.every((item) => item.fontStyle === 'italic'));
  underlineButton.classList.toggle('active', blocks.length > 0 && blocks.every((item) => item.textDecoration === 'underline'));
}

function selectBlock(index) {
  state.selected = index;
  state.selectedIndices = index >= 0 ? new Set([index]) : new Set();
  syncInspector();
  renderTextLayer();
}

function makeEditor(block, index, box, maskContext) {
  paintMask(maskContext, box);

  const wrapper = document.createElement('div');
  wrapper.className = 'inline-editor-wrapper';
  wrapper.style.left = `${box.left}px`;
  wrapper.style.top = `${box.top}px`;
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
    block.modified = true;
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
  replacement.style.top = `${box.top}px`;
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

function paintMask(context, box) {
  const bleed = 4;
  context.fillStyle = '#fff';
  context.fillRect(box.left - bleed, box.top - bleed, box.width + bleed * 2, box.height + bleed * 2);
}

function cssFontFamily(block) {
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
    target.addEventListener('pointerdown', (event) => event.stopPropagation());
    textLayer.appendChild(target);
    if (index === state.selected && state.selectedIndices.size === 1) {
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
    state.pdf = await getDocument({ data: state.sourceBytes }).promise;
    state.page = await state.pdf.getPage(1);
    state.viewport = state.page.getViewport({ scale: Math.min(2, 1000 / state.page.getViewport({ scale: 1 }).width) });
    state.selected = -1;
    state.history = [];
    state.future = [];

    pdfCanvas.width = state.viewport.width;
    pdfCanvas.height = state.viewport.height;
    maskCanvas.width = state.viewport.width;
    maskCanvas.height = state.viewport.height;
    pageInner.style.width = `${state.viewport.width}px`;
    pageInner.style.height = `${state.viewport.height}px`;
    await state.page.render({ canvasContext: pdfCanvas.getContext('2d'), viewport: state.viewport }).promise;
    const content = await state.page.getTextContent();
    state.blocks = content.items.map((item, index) => textItemToBlock({
      ...item,
      fontFamily: content.styles?.[item.fontName]?.fontFamily,
      ...fontMetadata(state.page, item),
    }, 1, index)).filter(Boolean);
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

    const fontFamily = font.fallbackName || font.name;
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
  if (!state.pdf) return;
  const output = await PDFDocument.load(state.sourceBytes);
  for (const block of state.blocks) {
    if (!block.modified || !block.text) continue;
    const page = output.getPages()[block.pageNumber - 1];
    const maskHeight = Math.max(block.height * 1.25, block.fontSize * 1.25);
    page.drawRectangle({
      x: block.x - 1,
      y: block.baseline - maskHeight * 0.15,
      width: block.width + 2,
      height: maskHeight,
      color: rgb(1, 1, 1),
    });
    await drawRichText(page, output, block);
  }
  const url = URL.createObjectURL(new Blob([await output.save()], { type: 'application/pdf' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'edited-document.pdf';
  link.click();
  URL.revokeObjectURL(url);
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
    const font = await output.embedFont(exportFont({ ...block, ...run }));
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

function exportFont(block) {
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
apply.addEventListener('click', () => {
  if (!selectedBlocks().length) return;
  recordHistory();
  selectedBlocks().forEach((item) => {
    item.text = textValue.value;
    item.modified = true;
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
    if (property === 'fontWeight' && value === '400') block.richHtml = '';
    if (property === 'fontStyle' && value === 'normal') block.richHtml = '';
    if (property === 'textDecoration' && value === 'none') block.richHtml = '';
    block.modified = true;
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
    block.richHtml = editor.innerHTML;
    block.modified = true;
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
  if (state.selecting) finishMarquee();
});

pdfCanvas.addEventListener('click', () => selectBlock(-1));

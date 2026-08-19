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
const status = $('status');
const pageInner = $('page-inner');
const pdfCanvas = $('pdf-canvas');
const maskCanvas = $('mask-canvas');
const textLayer = $('text-layer');

const state = { pdf: null, sourceBytes: null, page: null, viewport: null, blocks: [], selected: -1 };

function setStatus(message) { status.textContent = message; }
function selectedBlock() { return state.blocks[state.selected]; }

function syncInspector() {
  textValue.value = selectedBlock()?.text || '';
}

function selectBlock(index) {
  state.selected = index;
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
  editor.style.fontFamily = block.fontFamily;
  editor.style.fontSize = `${Math.max(block.fontSize * state.viewport.scale, 8)}px`;
  editor.style.fontWeight = block.fontWeight;
  editor.style.fontStyle = block.fontStyle;

  const run = document.createElement('span');
  run.className = 'edit-run';
  run.textContent = block.text;
  run.dataset.runIndex = '0';
  run.dataset.origWeight = block.fontWeight;
  run.dataset.origItalic = block.fontStyle === 'italic' ? 'true' : '';
  run.dataset.origUnderline = '';
  editor.appendChild(run);
  editor.addEventListener('input', () => {
    block.text = editor.textContent || '';
    syncInspector();
  });
  wrapper.appendChild(editor);
  textLayer.appendChild(wrapper);
  requestAnimationFrame(() => editor.focus());
}

function makeEditedText(block, box, maskContext) {
  paintMask(maskContext, box);

  const replacement = document.createElement('div');
  replacement.className = 'edited-text';
  replacement.textContent = block.text;
  replacement.style.left = `${box.left}px`;
  replacement.style.top = `${box.top}px`;
  replacement.style.width = `${Math.max(box.width, 12)}px`;
  replacement.style.height = `${Math.max(box.height, 12)}px`;
  replacement.style.fontFamily = block.fontFamily;
  replacement.style.fontSize = `${Math.max(block.fontSize * state.viewport.scale, 8)}px`;
  replacement.style.fontWeight = block.fontWeight;
  replacement.style.fontStyle = block.fontStyle;
  textLayer.appendChild(replacement);
}

function paintMask(context, box) {
  const bleed = 4;
  context.fillStyle = '#fff';
  context.fillRect(box.left - bleed, box.top - bleed, box.width + bleed * 2, box.height + bleed * 2);
}

function renderTextLayer() {
  textLayer.replaceChildren();
  const maskContext = maskCanvas.getContext('2d');
  maskContext.clearRect(0, 0, maskCanvas.width, maskCanvas.height);

  state.blocks.forEach((block, index) => {
    const box = blockRectangle(state.viewport, block);
    const target = document.createElement('div');
    target.className = 'text-target';
    target.title = `${block.text} Click to edit`;
    target.style.left = `${box.left}px`;
    target.style.top = `${box.top}px`;
    target.style.width = `${Math.max(box.width, 12)}px`;
    target.style.height = `${Math.max(box.height, 12)}px`;
    target.addEventListener('click', (event) => {
      event.stopPropagation();
      selectBlock(index);
    });
    textLayer.appendChild(target);
    if (index === state.selected) {
      makeEditor(block, index, box, maskContext);
    } else if (block.text !== block.originalText) {
      makeEditedText(block, box, maskContext);
    }
  });
}

async function openPdf(file) {
  if (!file) return;
  try {
    state.sourceBytes = new Uint8Array(await file.arrayBuffer());
    state.pdf = await getDocument({ data: state.sourceBytes }).promise;
    state.page = await state.pdf.getPage(1);
    state.viewport = state.page.getViewport({ scale: Math.min(2, 1000 / state.page.getViewport({ scale: 1 }).width) });
    state.selected = -1;

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

    const fontFamily = font.loadedName || font.fallbackName || font.name;
    const measuredWeight = detectFontWeight(fontFamily, item.str, item.width, item.height);

    return {
      fontWeight: font.bold || font.black || font.weight >= 700 ? '700' : measuredWeight,
      fontStyle: font.italic || font.style === 'italic' ? 'italic' : 'normal',
      fontFamily,
    };
  } catch {
    return {};
  }
}

function detectFontWeight(fontFamily, text, pdfWidth, pdfHeight) {
  if (!fontFamily || !text || !pdfWidth || !pdfHeight) return '400';

  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  const size = 100;
  context.font = `400 ${size}px "${fontFamily}"`;
  const normalWidth = context.measureText(text).width;
  context.font = `700 ${size}px "${fontFamily}"`;
  const boldWidth = context.measureText(text).width;
  const targetWidth = Number(pdfWidth) * (size / Number(pdfHeight));

  if (Math.abs(boldWidth - targetWidth) < Math.abs(normalWidth - targetWidth)) return '700';
  return '400';
}

async function downloadPdf() {
  if (!state.pdf) return;
  const output = await PDFDocument.load(state.sourceBytes);
  for (const block of state.blocks) {
    if (block.text === block.originalText || !block.text) continue;
    const page = output.getPages()[block.pageNumber - 1];
    const maskHeight = Math.max(block.height * 1.25, block.fontSize * 1.25);
    page.drawRectangle({
      x: block.x - 1,
      y: block.baseline - maskHeight * 0.15,
      width: block.width + 2,
      height: maskHeight,
      color: rgb(1, 1, 1),
    });
    const font = await output.embedFont(block.fontWeight === '700' ? StandardFonts.HelveticaBold : StandardFonts.Helvetica);
    page.drawText(block.text, { x: block.x, y: block.baseline, size: block.fontSize, font, color: rgb(0, 0, 0) });
  }
  const url = URL.createObjectURL(new Blob([await output.save()], { type: 'application/pdf' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'edited-document.pdf';
  link.click();
  URL.revokeObjectURL(url);
}

input.addEventListener('change', (event) => openPdf(event.target.files?.[0]));
save.addEventListener('click', downloadPdf);
apply.addEventListener('click', () => {
  const block = selectedBlock();
  if (!block) return;
  block.text = textValue.value;
  renderTextLayer();
});
pdfCanvas.addEventListener('click', () => selectBlock(-1));

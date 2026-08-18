import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

import './styles.css';
import { makeBlockFromPdfItem, normalizePdfTextItems } from './text-layout.js';

GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

const pdfInput = document.getElementById('pdf-input');
const saveButton = document.getElementById('save-button');
const blockText = document.getElementById('block-text');
const pageNumberInput = document.getElementById('page-number');
const applyEditButton = document.getElementById('apply-edit');

let pdfDoc = null;
let currentPage = 1;
let blocks = [];
let selectedBlockIndex = -1;
const pageBlockCache = new Map();

// Global state for viewport and drag
let state = {
  viewport: null,
  renderViewport: null,
  draggingBlockIndex: -1,
  dragStartX: 0,
  dragStartY: 0,
  dragStartBlockX: 0,
  dragStartBlockY: 0,
};

function updateSelectedBlock() {
  const items = document.querySelectorAll('.text-block');
  items.forEach((item, index) => item.classList.toggle('active', index === selectedBlockIndex));

  if (selectedBlockIndex >= 0 && blocks[selectedBlockIndex]) {
    blockText.value = blocks[selectedBlockIndex].text;
    pageNumberInput.value = blocks[selectedBlockIndex].pageNumber || currentPage;
  } else {
    blockText.value = '';
  }
}

function selectBlock(index) {
  selectedBlockIndex = index;
  updateSelectedBlock();
}

function pdfToCanvas(pdfX, pdfY, pdfW, pdfH) {
  if (!state.viewport || !state.renderViewport) return { left: 0, top: 0, width: 0, height: 0 };
  
  const left = (pdfX / state.viewport.width) * state.renderViewport.width;
  const top = state.renderViewport.height - ((pdfY + pdfH) / state.viewport.height) * state.renderViewport.height;
  const width = (pdfW / state.viewport.width) * state.renderViewport.width;
  const height = (pdfH / state.viewport.height) * state.renderViewport.height;

  return { left, top, width, height };
}



function canvasToPdf(canvasX, canvasY) {
  if (!state.viewport || !state.renderViewport) return { x: 0, y: 0 };
  
  const pdfX = (canvasX / state.renderViewport.width) * state.viewport.width;
  const pdfY = state.viewport.height - (canvasY / state.renderViewport.height) * state.viewport.height;

  return { x: pdfX, y: pdfY };
}

async function ensurePageBlocks(pageNumber) {
  if (!pdfDoc) return [];

  if (pageBlockCache.has(pageNumber)) {
    blocks = pageBlockCache.get(pageNumber);
    return blocks;
  }

  const page = await pdfDoc.getPage(pageNumber);
  const { items } = await page.getTextContent();
  const pageBlocks = normalizePdfTextItems(items)
    .map((item, index) => makeBlockFromPdfItem({
      ...item,
      x: item.x,
      y: item.y - item.height,
    }, pageNumber, index))
    .filter(Boolean);

  pageBlockCache.set(pageNumber, pageBlocks);
  blocks = pageBlocks;
  return blocks;
}

function setupEventHandlers(canvas) {
  canvas.onmousedown = (event) => {
    const rect = canvas.getBoundingClientRect();
    const canvasX = event.clientX - rect.left;
    const canvasY = event.clientY - rect.top;
    const pdf = canvasToPdf(canvasX, canvasY);

    const hitBlock = blocks.findIndex((block) => {
      if (block.pageNumber !== currentPage) return false;
      return (
        pdf.x >= block.x &&
        pdf.x <= block.x + block.width &&
        pdf.y >= block.y &&
        pdf.y <= block.y + block.height
      );
    });

    if (hitBlock >= 0) {
      state.draggingBlockIndex = hitBlock;
      state.dragStartX = event.clientX;
      state.dragStartY = event.clientY;
      state.dragStartBlockX = blocks[hitBlock].x;
      state.dragStartBlockY = blocks[hitBlock].y;
    }
  };

  canvas.onclick = (event) => {
    if (state.draggingBlockIndex >= 0) return;

    const rect = canvas.getBoundingClientRect();
    const canvasX = event.clientX - rect.left;
    const canvasY = event.clientY - rect.top;
    const pdf = canvasToPdf(canvasX, canvasY);

    const hitBlock = blocks.findIndex((block) => {
      if (block.pageNumber !== currentPage) return false;
      return (
        pdf.x >= block.x &&
        pdf.x <= block.x + block.width &&
        pdf.y >= block.y &&
        pdf.y <= block.y + block.height
      );
    });

    if (hitBlock >= 0) {
      selectedBlockIndex = hitBlock;
      updateSelectedBlock();
    } else {
      selectedBlockIndex = -1;
      updateSelectedBlock();
    }
  };
}

function setupGlobalDragHandlers() {
  document.onmousemove = (event) => {
    if (state.draggingBlockIndex < 0) return;

    const deltaX = (event.clientX - state.dragStartX) / state.renderViewport.width * state.viewport.width;
    const deltaY = (state.dragStartY - event.clientY) / state.renderViewport.height * state.viewport.height;

    blocks[state.draggingBlockIndex].x = state.dragStartBlockX + deltaX;
    blocks[state.draggingBlockIndex].y = state.dragStartBlockY + deltaY;

    updateOverlay();
  };

  document.onmouseup = () => {
    if (state.draggingBlockIndex >= 0) {
      selectedBlockIndex = state.draggingBlockIndex;
      updateSelectedBlock();
    }
    state.draggingBlockIndex = -1;
  };
}

function updateOverlay() {
  const overlay = document.getElementById('text-overlay');
  const boxes = overlay.querySelectorAll('.text-block');
  
  blocks.forEach((block, index) => {
    if (block.pageNumber !== currentPage) return;
    
    const box = pdfToCanvas(block.x, block.y, block.width, block.height);
    if (boxes[index]) {
      boxes[index].style.left = `${box.left}px`;
      boxes[index].style.top = `${box.top}px`;
      boxes[index].style.width = `${Math.max(box.width, 12)}px`;
      boxes[index].style.height = `${Math.max(box.height, 12)}px`;
    }
  });
}

async function renderPage() {
  if (!pdfDoc) return;

  const page = await pdfDoc.getPage(currentPage);
  // Text coordinates from getTextContent() are ALWAYS in original PDF space (scale 1.0)
  state.viewport = page.getViewport({ scale: 1.0 });
  const scale = Math.min(2, 1000 / state.viewport.width);
  state.renderViewport = page.getViewport({ scale });

  const canvas = document.getElementById('pdf-canvas');
  const overlay = document.getElementById('text-overlay');

  canvas.width = state.renderViewport.width;
  canvas.height = state.renderViewport.height;
  overlay.style.width = `${state.renderViewport.width}px`;
  overlay.style.height = `${state.renderViewport.height}px`;
  overlay.innerHTML = '';
  overlay.style.pointerEvents = 'none';

  const context = canvas.getContext('2d');
  await page.render({ canvasContext: context, viewport: state.renderViewport }).promise;

  const pageBlocks = await ensurePageBlocks(currentPage);
  blocks = pageBlocks;
  selectedBlockIndex = selectedBlockIndex >= 0 && blocks[selectedBlockIndex] ? selectedBlockIndex : -1;

  setupEventHandlers(canvas);

  pageBlocks.forEach((block, index) => {
    if (block.pageNumber !== currentPage) return;

    const box = pdfToCanvas(block.x, block.y, block.width, block.height);

    const element = document.createElement('button');
    element.type = 'button';
    element.className = `text-block ${index === selectedBlockIndex ? 'active' : ''}`;
    element.textContent = block.text;
    element.title = block.text;
    element.style.left = `${box.left}px`;
    element.style.top = `${box.top}px`;
    element.style.width = `${Math.max(box.width, 12)}px`;
    element.style.height = `${Math.max(box.height, 12)}px`;
    element.style.pointerEvents = 'auto';
    element.style.opacity = index === selectedBlockIndex ? '1' : '0';
    element.style.transition = 'opacity 0.2s ease';
    element.addEventListener('mouseenter', () => {
      element.style.opacity = '1';
    });
    element.addEventListener('mouseleave', () => {
      if (index !== selectedBlockIndex) element.style.opacity = '0';
    });
    element.addEventListener('click', (event) => {
      event.stopPropagation();
      selectBlock(index);
      renderPage();
    });
    overlay.appendChild(element);
  });

  updateSelectedBlock();
}

function loadPdf(file) {
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    const bytes = new Uint8Array(event.target.result);
    getDocument({ data: bytes }).promise
      .then((doc) => {
        pdfDoc = doc;
        pageBlockCache.clear();
        currentPage = 1;
        blocks = [];
        selectedBlockIndex = -1;
        pageNumberInput.value = currentPage;
        return renderPage();
      })
      .catch((error) => {
        console.error('Failed to open PDF', error);
        alert('Unable to read the PDF file.');
      });
  };
  reader.readAsArrayBuffer(file);
}

function applyBlockEdit() {
  if (selectedBlockIndex < 0 || !blocks[selectedBlockIndex]) return;

  const nextPage = Number(pageNumberInput.value) || currentPage;
  const edited = blocks[selectedBlockIndex];
  edited.text = blockText.value.trim();
  edited.pageNumber = nextPage;
  currentPage = nextPage;
  updateSelectedBlock();
  renderPage();
}

async function saveEditedPdf() {
  if (!pdfDoc) return;

  const sourceBytes = await pdfDoc.getData();
  const pdfBytes = await PDFDocument.load(sourceBytes);
  const font = await pdfBytes.embedFont(StandardFonts.Helvetica);

  for (const block of blocks) {
    if (!block || !block.text) continue;

    const pageIndex = Math.max(0, (Number(block.pageNumber) || currentPage) - 1);
    const page = pdfBytes.getPages()[pageIndex];
    if (!page) continue;

    page.drawText(block.text, {
      x: block.x,
      y: page.getHeight() - block.y - (block.height || 12),
      size: 12,
      font,
      color: rgb(0, 0, 0),
    });
  }

  const output = await pdfBytes.save();
  const blob = new Blob([output], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'edited-document.pdf';
  link.click();
  URL.revokeObjectURL(url);
}

pdfInput.addEventListener('change', (event) => {
  const file = event.target.files && event.target.files[0];
  loadPdf(file);
});

saveButton.addEventListener('click', saveEditedPdf);
applyEditButton.addEventListener('click', applyBlockEdit);
pageNumberInput.addEventListener('change', () => {
  const page = Number(pageNumberInput.value) || 1;
  currentPage = Math.min(Math.max(page, 1), pdfDoc ? pdfDoc.numPages : 1);
  blocks = [];
  selectedBlockIndex = -1;
  updateSelectedBlock();
  renderPage();
});

setupGlobalDragHandlers();
updateSelectedBlock();

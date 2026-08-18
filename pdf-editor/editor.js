(function () {
  const pdfInput = document.getElementById("pdf-input");
  const detectButton = document.getElementById("detect-button");
  const saveButton = document.getElementById("save-button");
  const blockText = document.getElementById("block-text");
  const pageNumberInput = document.getElementById("page-number");
  const applyEditButton = document.getElementById("apply-edit");

  let pdfDoc = null;
  let currentPage = 1;
  let blocks = [];
  let selectedBlockIndex = -1;

  function updateSelectedBlock() {
    const items = document.querySelectorAll(".text-block");
    items.forEach((item, index) => {
      item.classList.toggle("active", index === selectedBlockIndex);
    });

    if (selectedBlockIndex >= 0 && blocks[selectedBlockIndex]) {
      blockText.value = blocks[selectedBlockIndex].text;
      pageNumberInput.value = blocks[selectedBlockIndex].pageNumber || currentPage;
    } else {
      blockText.value = "";
    }
  }

  function selectBlock(index) {
    selectedBlockIndex = index;
    updateSelectedBlock();
  }

  function loadPdf(file) {
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = function (event) {
      const typedArray = new Uint8Array(event.target.result);
      pdfjsLib.getDocument({ data: typedArray }).promise.then((doc) => {
        pdfDoc = doc;
        currentPage = 1;
        blocks = [];
        selectedBlockIndex = -1;
        pageNumberInput.value = currentPage;
        renderCurrentPage();
      }).catch((error) => {
        console.error("Failed to open PDF", error);
        alert("Unable to read the PDF file.");
      });
    };
    reader.readAsArrayBuffer(file);
  }

  function renderCurrentPage() {
    if (!pdfDoc) {
      return;
    }

    const safePageNumber = Math.min(Math.max(Number(currentPage) || 1, 1), pdfDoc.numPages);
    currentPage = safePageNumber;
    pageNumberInput.value = currentPage;

    PdfEditorBlockDetect.detectTextBlocksForPage(pdfDoc, currentPage).then((pageBlocks) => {
      blocks = pageBlocks;
      selectedBlockIndex = -1;
      blockText.value = "";
      PdfEditorRenderer.renderPage(pdfDoc, currentPage, pageBlocks, {
        onSelect: selectBlock,
      }).then(() => {
        updateSelectedBlock();
      });
    });
  }

  function applyBlockEdit() {
    if (selectedBlockIndex < 0 || !blocks[selectedBlockIndex]) {
      return;
    }

    const nextPage = Number(pageNumberInput.value) || currentPage;
    blocks[selectedBlockIndex].text = blockText.value;
    blocks[selectedBlockIndex].pageNumber = nextPage;
    currentPage = nextPage;
    renderCurrentPage();
  }

  pdfInput.addEventListener("change", (event) => {
    const file = event.target.files && event.target.files[0];
    loadPdf(file);
  });

  detectButton.addEventListener("click", () => {
    if (!pdfDoc) {
      return;
    }
    renderCurrentPage();
  });

  saveButton.addEventListener("click", () => {
    if (!pdfDoc) {
      return;
    }
    PdfEditorSave.saveEditedPdf(pdfDoc, blocks, "edited-document.pdf");
  });

  applyEditButton.addEventListener("click", applyBlockEdit);

  pageNumberInput.addEventListener("change", () => {
    const page = Number(pageNumberInput.value) || 1;
    currentPage = Math.min(Math.max(page, 1), pdfDoc ? pdfDoc.numPages : 1);
    renderCurrentPage();
  });
})();

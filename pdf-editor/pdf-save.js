(function () {
  function saveEditedPdf(pdfDoc, blocks, fileName = "edited-document.pdf") {
    if (!pdfDoc || !window.jspdf || !window.jspdf.jsPDF) {
      return;
    }

    const firstPage = pdfDoc.getPage(1);
    firstPage.then((page) => {
      const viewport = page.getViewport({ scale: 1 });
      const doc = new window.jspdf.jsPDF({
        unit: "pt",
        format: [viewport.width, viewport.height],
      });

      const safeBlocks = Array.isArray(blocks) ? blocks : [];

      doc.setFontSize(11);
      safeBlocks.forEach((block) => {
        const textX = block.x || 20;
        const textY = viewport.height - (block.y || 20);
        const text = block.text || "";
        doc.text(text, textX, textY, { maxWidth: block.width || 150 });
      });

      doc.save(fileName);
    });
  }

  window.PdfEditorSave = {
    saveEditedPdf,
  };
})();

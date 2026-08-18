(function () {
  function renderPage(pdfDoc, pageNumber, blocks, options = {}) {
    if (!pdfDoc || !pageNumber) {
      return Promise.resolve();
    }

    const canvas = document.getElementById("pdf-canvas");
    const overlay = document.getElementById("text-overlay");

    if (!canvas || !overlay) {
      return Promise.resolve();
    }

    return pdfDoc.getPage(pageNumber).then((page) => {
      const viewport = page.getViewport({ scale: 1.4 });
      const scale = Math.min(1.4, 850 / viewport.width);
      const renderViewport = page.getViewport({ scale });

      canvas.width = renderViewport.width;
      canvas.height = renderViewport.height;
      overlay.style.width = `${renderViewport.width}px`;
      overlay.style.height = `${renderViewport.height}px`;
      overlay.innerHTML = "";

      const ctx = canvas.getContext("2d");
      const renderTask = page.render({
        canvasContext: ctx,
        viewport: renderViewport,
      });

      return renderTask.promise.then(() => {
        const safeBlocks = Array.isArray(blocks) ? blocks : [];
        safeBlocks.forEach((block, index) => {
          const blockElement = document.createElement("button");
          blockElement.type = "button";
          blockElement.className = "text-block";
          blockElement.style.left = `${(block.x / viewport.width) * renderViewport.width}px`;
          blockElement.style.top = `${(1 - block.y / viewport.height) * renderViewport.height}px`;
          blockElement.style.width = `${(block.width / viewport.width) * renderViewport.width}px`;
          blockElement.style.height = `${(block.height / viewport.height) * renderViewport.height}px`;
          blockElement.setAttribute("data-index", String(index));
          blockElement.title = block.text;

          blockElement.addEventListener("click", () => {
            if (typeof options.onSelect === "function") {
              options.onSelect(index);
            }
          });

          overlay.appendChild(blockElement);
        });
      });
    });
  }

  window.PdfEditorRenderer = {
    renderPage,
  };
})();

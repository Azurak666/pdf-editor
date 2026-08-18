(function () {
  function normalizeWords(items) {
    return items
      .filter((item) => item && item.str && item.str.trim())
      .map((item) => {
        const transform = item.transform || [1, 0, 0, 1, 0, 0];
        const x = Number(transform[4]) || 0;
        const y = Number(transform[5]) || 0;
        const width = Number(item.width) || Math.max(8, item.str.length * 6);
        const height = Number(item.height) || 12;

        return {
          str: String(item.str).trim(),
          x,
          y,
          width,
          height,
        };
      });
  }

  function createLineGroups(words) {
    const lines = [];

    words.forEach((word) => {
      const line = lines.find((item) => Math.abs(item.centerY - word.y) <= 10);

      if (line) {
        line.items.push(word);
        line.centerY = (line.centerY * line.items.length + word.y) / (line.items.length + 1);
      } else {
        lines.push({
          centerY: word.y,
          items: [word],
        });
      }
    });

    lines.forEach((line) => {
      line.items.sort((a, b) => a.x - b.x);
    });

    return lines.sort((a, b) => b.centerY - a.centerY);
  }

  function detectTextBlocksForPage(pdfDoc, pageNumber) {
    return pdfDoc.getPage(pageNumber).then((page) => {
      return page.getTextContent().then(({ items }) => {
        const words = normalizeWords(items);
        const lines = createLineGroups(words);

        return lines
          .map((line, index) => {
            const xValues = line.items.map((item) => item.x);
            const xMaxValues = line.items.map((item) => item.x + item.width);
            const yValues = line.items.map((item) => item.y);
            const heights = line.items.map((item) => item.height);

            const x = Math.min(...xValues);
            const width = Math.max(...xMaxValues) - x;
            const y = Math.max(...yValues);
            const height = Math.max(...heights) + 8;
            const text = line.items.map((item) => item.str).join(" ");

            return {
              id: `page-${pageNumber}-block-${index}`,
              pageNumber,
              x,
              y,
              width: Math.max(width, 30),
              height: Math.max(height, 18),
              text,
            };
          })
          .filter((block) => block.text && block.text.length > 0);
      });
    });
  }

  window.PdfEditorBlockDetect = {
    detectTextBlocksForPage,
  };
})();

# PDF Text Editor

A browser-based PDF text editor built with PDF.js and pdf-lib.

## Run

```bash
npm install
npm run dev
```

Open the local Vite URL, choose a PDF, click extracted text, edit it inline, and download the result.

## Architecture

- PDF.js renders the source page to a canvas.
- A separate mask canvas hides only the selected original text.
- A transparent text layer provides click targets.
- The selected item becomes a positioned `contenteditable` inline editor.
- pdf-lib exports changed text while leaving unchanged PDF content intact.

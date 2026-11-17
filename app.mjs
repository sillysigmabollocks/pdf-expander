const byId = (id) => document.getElementById(id);
const fileInput = byId('file');
const chooseButton = byId('choose');
const pasteButton = byId('paste');
const dropzone = byId('dropzone');
const pasteBox = byId('pasteBox');
const pasteTarget = byId('pasteTarget');
const controls = byId('settings');
const buildButton = byId('build');
const preview = byId('viewer');
const previewHeading = byId('preview-heading');
const placeholder = byId('placeholder');
const stageMessage = byId('stageMessage');
const canvasSlot = byId('canvasSlot');
const pagination = byId('pagination');
const previous = byId('previous');
const next = byId('next');
const result = byId('result');
const openLink = byId('open');
const downloadLink = byId('download');
const share = byId('share');

let selectedFile;
let outputFile;
let outputUrl;
let previewTask;
let previewDoc;
let renderTask;
let revision = 0;
let pageNumber = 1;
let building = false;
let fileRequest = 0;
let pdfPreviewModule;
let engine;
let resizeTimer;

function settings() {
  return {
    side: controls.querySelector('input[name=side]:checked').value,
    paper: controls.querySelector('input[name=paper]:checked').value,
    width: Number(byId('width').value),
    spacing: Number(byId('spacing').value),
    red: byId('red').checked,
  };
}

function status(message = '', error = false, id = 'status') {
  const element = byId(id);
  element.textContent = message;
  element.classList.toggle('error', error);
  element.hidden = !message;
}

function updateLayout() {
  const config = settings();
  byId('widthValue').value = `${config.width}%`;
  byId('spacingValue').value = `${config.spacing} pt`;
  byId('spacing').disabled = config.paper === 'blank';
  byId('spacingRow').hidden = config.paper === 'blank';
  const sample = byId('sample');
  sample.className = `sample ${config.side} ${config.paper}`;
  sample.classList.toggle('red', config.red);
  sample.style.setProperty('--sample-notes', `clamp(${1.35 * config.width}px, ${0.19 * config.width}vw, ${2.60 * config.width}px)`);
  sample.style.setProperty('--sample-spacing', `${Math.max(3, config.spacing * 0.63)}px`);
}

function showPlaceholder(message) {
  stageMessage.textContent = message;
  placeholder.hidden = false;
  canvasSlot.hidden = true;
}

function clearResult(message) {
  renderTask?.cancel();
  renderTask = undefined;
  if (previewTask) void previewTask.destroy().catch(() => {});
  previewTask = undefined;
  previewDoc = undefined;
  revision++;
  if (outputUrl) URL.revokeObjectURL(outputUrl);
  outputUrl = undefined;
  outputFile = undefined;
  result.hidden = true;
  pagination.hidden = true;
  openLink.removeAttribute('href');
  downloadLink.removeAttribute('href');
  canvasSlot.replaceChildren();
  status('', false, 'shareStatus');
  showPlaceholder(message);
}

function setBusy(busy) {
  building = busy;
  controls.disabled = busy;
  buildButton.disabled = busy || !selectedFile;
  chooseButton.disabled = busy;
  pasteButton.disabled = busy;
}

function fileSize(bytes) {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

async function selectFile(candidates, statusId = 'status') {
  if (building || !candidates.length) return;
  const request = ++fileRequest;
  let pdf;
  for (const candidate of candidates) {
    try {
      const header = await candidate.slice(0, 1024).text();
      if (header.includes('%PDF-')) {
        pdf = candidate;
        break;
      }
    } catch {
      continue;
    }
  }
  if (building || request !== fileRequest) return;
  if (!pdf) {
    status('This item does not contain a readable PDF. Tap Choose PDF to open it from Files.', true, statusId);
    return;
  }
  selectedFile = pdf;
  pasteBox.hidden = true;
  pasteButton.setAttribute('aria-expanded', 'false');
  pasteTarget.replaceChildren(document.createElement('br'));
  status('', false, 'pasteStatus');
  byId('fileName').textContent = pdf.name || 'Pasted PDF';
  byId('fileInfo').textContent = fileSize(pdf.size);
  dropzone.classList.add('loaded');
  clearResult('Tap Create preview to see your PDF');
  setBusy(false);
  status();
}

function transferredFiles(data) {
  if (!data) return [];
  const files = Array.from(data.files || []);
  for (const item of Array.from(data.items || [])) {
    if (item.kind !== 'file') continue;
    const file = item.getAsFile();
    if (file) files.push(file);
  }
  return files;
}

chooseButton.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  const files = Array.from(fileInput.files);
  fileInput.value = '';
  void selectFile(files);
});

dropzone.addEventListener('dragover', (event) => {
  const data = event.dataTransfer;
  if (!Array.from(data?.types || []).includes('Files') &&
      !Array.from(data?.items || []).some((item) => item.kind === 'file')) return;
  event.preventDefault();
  dropzone.classList.add('dragover');
});
dropzone.addEventListener('dragleave', (event) => {
  if (!dropzone.contains(event.relatedTarget)) dropzone.classList.remove('dragover');
});
dropzone.addEventListener('drop', (event) => {
  event.preventDefault();
  dropzone.classList.remove('dragover');
  void selectFile(transferredFiles(event.dataTransfer));
});

let pasteAttempt = 0;

pasteButton.addEventListener('click', async () => {
  pasteBox.hidden = false;
  pasteButton.setAttribute('aria-expanded', 'true');
  pasteTarget.focus();
  status('', false, 'pasteStatus');
  if (!navigator.clipboard?.read) return;

  const attempt = ++pasteAttempt;
  const request = fileRequest;
  const isCurrent = () => attempt === pasteAttempt && request === fileRequest && !building;
  try {
    const files = [];
    for (const item of await navigator.clipboard.read()) {
      const type = item.types.find((value) => /^(?:web )?application\/(?:x-)?pdf$|^com\.adobe\.pdf$/i.test(value));
      if (type) files.push(new File([await item.getType(type)], 'Pasted.pdf', { type: 'application/pdf' }));
    }
    if (!isCurrent()) return;
    if (files.length) {
      await selectFile(files, 'pasteStatus');
    } else {
      status('Touch and hold the field below the Paste PDF button, then tap Paste. You can also tap Choose PDF.', false, 'pasteStatus');
    }
  } catch {
    // Native paste can still provide a file if async clipboard access is denied.
  }
});

function handleNativePaste(event, data) {
  const inPasteField = pasteTarget.contains(event.target);
  const files = transferredFiles(data);
  if (!inPasteField && !files.length) return;
  ++pasteAttempt;
  event.preventDefault();
  if (files.length) {
    void selectFile(files, inPasteField ? 'pasteStatus' : 'status');
  } else {
    status('This paste did not include a PDF file. Tap Choose PDF to open it from Files.', true, 'pasteStatus');
  }
}

document.addEventListener('paste', (event) => {
  handleNativePaste(event, event.clipboardData);
});

pasteTarget.addEventListener('beforeinput', (event) => {
  if (event.inputType === 'insertFromPaste') handleNativePaste(event, event.dataTransfer);
});

controls.addEventListener('input', () => {
  updateLayout();
  if (outputFile) {
    clearResult('Tap Create preview to apply your changes');
    byId('previewDescription').textContent = 'Review the finished PDF before sharing.';
    status();
  }
});

async function getPreviewEngine() {
  if (!pdfPreviewModule) pdfPreviewModule = import('https://cdn.jsdelivr.net/npm/pdfjs-dist@5.7.284/legacy/build/pdf.min.mjs').catch((error) => {
    pdfPreviewModule = undefined;
    throw error;
  });
  const pdfjs = await pdfPreviewModule;
  pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.7.284/legacy/build/pdf.worker.min.mjs';
  return pdfjs;
}

function pageControls() {
  if (!previewDoc) return;
  byId('pageCount').textContent = `${pageNumber} / ${previewDoc.numPages}`;
  previous.disabled = pageNumber === 1;
  next.disabled = pageNumber === previewDoc.numPages;
}

async function renderPage(newPage) {
  if (!previewDoc || newPage < 1 || newPage > previewDoc.numPages) return;
  const request = ++revision;
  const doc = previewDoc;
  renderTask?.cancel();
  renderTask = undefined;
  pageNumber = newPage;
  pageControls();
  canvasSlot.setAttribute('aria-busy', 'true');
  try {
    const page = await doc.getPage(newPage);
    if (request !== revision) return;
    const natural = page.getViewport({ scale: 1 });
    const available = Math.max(140, byId('stage').clientWidth - 50);
    const pixels = Math.min(2, window.devicePixelRatio || 1);
    const scale = Math.min(available * pixels / natural.width, 2300 / Math.max(natural.width, natural.height));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    canvas.style.width = `${Math.round(viewport.width / pixels)}px`;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', `PDF preview, page ${newPage} of ${doc.numPages}`);
    const context = canvas.getContext('2d', { alpha: false });
    renderTask = page.render({ canvas, canvasContext: context, viewport });
    await renderTask.promise;
    if (request !== revision) return;
    canvasSlot.replaceChildren(canvas);
    placeholder.hidden = true;
    canvasSlot.hidden = false;
    page.cleanup();
  } catch {
    if (request === revision) showPlaceholder('This page could not be drawn here. Tap Open PDF to view it.');
  } finally {
    if (request === revision) {
      renderTask = undefined;
      canvasSlot.removeAttribute('aria-busy');
    }
  }
}

previous.addEventListener('click', () => void renderPage(pageNumber - 1));
next.addEventListener('click', () => void renderPage(pageNumber + 1));
window.addEventListener('resize', () => {
  if (!previewDoc) return;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => void renderPage(pageNumber), 180);
});

function openResult(bytes, file, count, side) {
  const name = `${(file.name || 'Pasted.pdf').replace(/\.pdf$/i, '')}_notes-${side}.pdf`;
  outputFile = new File([bytes], name, { type: 'application/pdf' });
  outputUrl = URL.createObjectURL(outputFile);
  openLink.href = outputUrl;
  downloadLink.href = outputUrl;
  downloadLink.download = name;
  byId('resultName').textContent = name;
  byId('previewDescription').textContent = `${count} ${count === 1 ? 'page' : 'pages'} · ${fileSize(outputFile.size)}`;
  const canShare = Boolean(navigator.share && (!navigator.canShare || navigator.canShare({ files: [outputFile] })));
  share.hidden = !canShare;
  byId('shareHint').textContent = canShare
    ? 'On iPad, tap Share PDF and choose Goodnotes.'
    : 'Open PDF to view it in your browser. On iPad, use Safari’s Share menu to send it to Goodnotes.';
  result.hidden = false;
}

buildButton.addEventListener('click', async () => {
  if (!selectedFile || building) return;
  const file = selectedFile;
  const config = settings();
  clearResult('Building your preview…');
  setBusy(true);
  status('Opening PDF…');
  try {
    if (!window.PDFLib) throw new Error('The PDF engine could not load. Reload this page and try again.');
    engine ??= await import('./pdf-margin.mjs');
    const extended = await engine.extendPdf(await file.arrayBuffer(), config, async (page, total) => {
      status(`Preparing page ${page} of ${total}…`);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    openResult(extended.bytes, file, extended.count, config.side);
    status('Rendering preview…');
    try {
      const pdfjs = await getPreviewEngine();
      const assets = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.7.284/';
      previewTask = pdfjs.getDocument({
        data: extended.bytes,
        cMapUrl: `${assets}cmaps/`,
        cMapPacked: true,
        standardFontDataUrl: `${assets}standard_fonts/`,
        wasmUrl: `${assets}wasm/`,
        iccUrl: `${assets}iccs/`,
        isEvalSupported: false,
        enableXfa: false,
      });
      previewDoc = await previewTask.promise;
      pagination.hidden = previewDoc.numPages === 1;
      await renderPage(1);
    } catch {
      showPlaceholder('In-page preview is unavailable. Tap Open PDF to view the finished file.');
    }
    status();
    if (window.matchMedia('(max-width: 740px)').matches) {
      preview.scrollIntoView({ block: 'start' });
      previewHeading.focus({ preventScroll: true });
    }
  } catch (error) {
    const detail = error?.message || '';
    const message = /encrypt|password/i.test(detail)
      ? 'This PDF is password-protected or encrypted. Open an unlocked copy and try again.'
      : detail.startsWith('The PDF engine') ? detail : 'This PDF could not be processed. Try opening or re-exporting it as a fresh PDF first.';
    status(message, true);
    showPlaceholder('Could not create a preview');
  } finally {
    setBusy(false);
  }
});

share.addEventListener('click', async () => {
  if (!outputFile) return;
  status('', false, 'shareStatus');
  try {
    await navigator.share({ files: [outputFile] });
  } catch (error) {
    if (error?.name !== 'AbortError') {
      status('The share sheet could not open. Tap Open PDF and use Safari’s Share button.', true, 'shareStatus');
    }
  }
});

updateLayout();

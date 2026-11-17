const {
  PDFDocument, PDFName, PDFNumber, clip, endPath, popGraphicsState,
  pushGraphicsState, rectangle, rgb,
} = globalThis.PDFLib;

function visibleBox(page) {
  const media = page.getMediaBox();
  const crop = page.getCropBox();
  const x = Math.max(media.x, crop.x);
  const y = Math.max(media.y, crop.y);
  const right = Math.min(media.x + media.width, crop.x + crop.width);
  const top = Math.min(media.y + media.height, crop.y + crop.height);
  return right > x && top > y ? { x, y, width: right - x, height: top - y } : media;
}

function pageAxes(box, angle) {
  const { x, y, width, height } = box;
  switch (angle) {
    case 90:
      return { width: height, height: width, at: (u, v) => ({ x: x + width - v, y: y + u }) };
    case 180:
      return { width, height, at: (u, v) => ({ x: x + width - u, y: y + height - v }) };
    case 270:
      return { width: height, height: width, at: (u, v) => ({ x: x + v, y: y + height - u }) };
    default:
      return { width, height, at: (u, v) => ({ x: x + u, y: y + v }) };
  }
}

function clipOriginalArtwork(page, box) {
  if (!page.node.Contents()) return;
  const context = page.doc.context;
  page.node.normalize();
  const start = context.contentStream([
    pushGraphicsState(),
    rectangle(box.x, box.y, box.width, box.height),
    clip(),
    endPath(),
  ]);
  const end = context.contentStream([popGraphicsState()]);
  page.node.wrapContentStreams(context.register(start), context.register(end));
}

function widenPage(page, settings) {
  const original = visibleBox(page);
  const angle = (page.getRotation().angle % 360 + 360) % 360;
  const { width, height, at } = pageAxes(original, angle);
  const margin = width * settings.width / 100;
  const left = settings.side === 'left';
  const start = left ? -margin : width;
  const finish = start + margin;
  const first = at(left ? start : 0, 0);
  const opposite = at(left ? width : finish, height);

  clipOriginalArtwork(page, original);
  const bounds = [
    Math.min(first.x, opposite.x), Math.min(first.y, opposite.y),
    Math.abs(first.x - opposite.x), Math.abs(first.y - opposite.y),
  ];
  page.setMediaBox(...bounds);
  page.setCropBox(...bounds);
  page.setBleedBox(...bounds);
  page.setTrimBox(...bounds);
  page.setArtBox(...bounds);

  const userUnit = page.node.lookupMaybe(PDFName.of('UserUnit'), PDFNumber)?.asNumber() || 1;
  const spacing = settings.spacing / userUnit;
  const gutter = Math.min(12 / userUnit, margin * 0.15, height * 0.10);
  const gridColor = rgb(0.70, 0.80, 0.84);
  const separator = rgb(0.78, 0.82, 0.83);
  const red = rgb(0.88, 0.50, 0.52);
  const line = (u1, v1, u2, v2, color, thickness = 0.55) => {
    page.drawLine({ start: at(u1, v1), end: at(u2, v2), color, thickness: thickness / userUnit });
  };

  if (settings.paper !== 'blank') {
    for (let y = spacing; y < height; y += spacing) {
      line(start + gutter, y, finish - gutter, y, gridColor);
    }
  }
  if (settings.paper === 'grid') {
    for (let x = start + spacing; x < finish; x += spacing) {
      line(x, gutter, x, height - gutter, gridColor);
    }
  }
  if (settings.red) {
    const x = start + Math.min(36 / userUnit, margin * 0.18);
    line(x, 0, x, height, red, 0.8);
  }
  const seam = left ? 0 : width;
  line(seam, 0, seam, height, separator, 0.6);
}

export async function extendPdf(bytes, settings, onProgress = async () => {}) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const pages = doc.getPages();
  if (!pages.length) throw new Error('This PDF has no pages.');
  for (let index = 0; index < pages.length; index++) {
    if (index % 5 === 0) await onProgress(index + 1, pages.length);
    widenPage(pages[index], settings);
  }
  await onProgress(pages.length, pages.length);
  return {
    bytes: await doc.save({ useObjectStreams: false, updateFieldAppearances: false }),
    count: pages.length,
  };
}

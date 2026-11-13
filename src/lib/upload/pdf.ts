/**
 * Combines scanned page images into one PDF in the browser with pdf-lib. Each page keeps
 * the photo's aspect ratio at US Letter width (8.5 in). pdf-lib is loaded on demand so it
 * only downloads on the scan screen.
 */

const LETTER_WIDTH_PT = 612;

export interface PageImage {
  bytes: Uint8Array;
  kind: 'jpeg' | 'png';
}

export async function buildPdf(pages: PageImage[]): Promise<Uint8Array> {
  if (pages.length === 0) throw new Error('No pages to combine');
  const { PDFDocument } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  doc.setTitle('Scanned document');
  doc.setProducer('Quail Hollow client portal');
  doc.setCreator('Quail Hollow client portal');

  for (const page of pages) {
    const image =
      page.kind === 'png' ? await doc.embedPng(page.bytes) : await doc.embedJpg(page.bytes);
    const scale = LETTER_WIDTH_PT / image.width;
    const width = LETTER_WIDTH_PT;
    const height = Math.round(image.height * scale);
    const pdfPage = doc.addPage([width, height]);
    pdfPage.drawImage(image, { x: 0, y: 0, width, height });
  }
  return doc.save({ useObjectStreams: true });
}

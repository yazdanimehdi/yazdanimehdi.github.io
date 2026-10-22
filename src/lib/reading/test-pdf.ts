/**
 * A one-font PDF for tests: each page is a list of [y, text] lines drawn at x 72 in Helvetica 12.
 * Lives outside a .test.ts so importing it doesn't rerun a test file.
 */
export function minimalPdf(pages: [number, string][][]): Uint8Array {
  const esc = (s: string) => s.replace(/[\\()]/g, '\\$&');
  const objs: string[] = [];
  const add = (body: string) => objs.push(body) && objs.length;
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add(''); // Pages, filled in once the kids are known
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const kids = pages.map((lines) => {
    const stream = lines.map(([y, text]) => `BT /F1 12 Tf 72 ${y} Td (${esc(text)}) Tj ET`).join('\n');
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    return add(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`,
    );
  });
  objs[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  let pdf = '%PDF-1.4\n';
  const offsets = objs.map((body, i) => {
    const at = pdf.length;
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return at;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

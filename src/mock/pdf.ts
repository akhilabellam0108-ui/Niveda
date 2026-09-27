/**
 * Builds a small, valid single-page PDF containing text. Used so the demo
 * patient's reports are real files you can open and download.
 */
function esc(s: string) {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)').replace(/[^\x20-\x7e]/g, '-');
}

export function makeTextPdf(title: string, lines: string[], footer: string): Blob {
  const ops: string[] = ['BT', '/F2 18 Tf', '56 780 Td', `(${esc(title)}) Tj`, '/F1 11 Tf', '0 -30 Td'];
  for (const line of lines) {
    if (line === '') { ops.push('0 -10 Td'); continue; }
    if (line.startsWith('# ')) { ops.push('/F2 12 Tf', '0 -8 Td', `(${esc(line.slice(2))}) Tj`, '/F1 11 Tf', '0 -18 Td'); continue; }
    ops.push(`(${esc(line)}) Tj`, '0 -16 Td');
  }
  ops.push('ET', 'BT', '/F1 8 Tf', '56 40 Td', `(${esc(footer)}) Tj`, 'ET');
  ops.push('0.85 0.88 0.86 RG', '1 w', '56 766 m 540 766 l S');
  const content = ops.join('\n');

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Blob([pdf], { type: 'application/pdf' });
}

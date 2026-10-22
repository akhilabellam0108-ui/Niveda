/**
 * Built-in safety check for uploaded documents. Runs on the server (document-access
 * Edge Function) before a file can be opened, and in the browser before upload.
 *
 * It checks what the file really is from its first bytes (not its name), that this
 * matches the type it claims to be, and refuses anything that can run code:
 * programs, archives and Office files, web pages and SVG images, and PDFs with
 * JavaScript, launch actions, embedded files or Flash/XFA. It also recognises the
 * standard EICAR antivirus test file.
 *
 * This is not a full antivirus (it doesn't know specific viruses, and doesn't open
 * compressed PDF streams); docs/SECURITY.md says how to add one.
 */
export type ScanResult = { ok: true; kind: FileKind } | { ok: false; reason: string };
export type FileKind = 'pdf' | 'png' | 'jpeg' | 'gif' | 'webp' | 'heic' | 'text';

const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, Math.min(to, b.length)));
const startsWith = (b: Uint8Array, sig: number[], at = 0) => sig.every((x, i) => b[at + i] === x);

/** Latin-1 view of the whole file, for searching PDF keywords. */
function latin1(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return s;
}

function detect(b: Uint8Array): FileKind | 'exe' | 'archive' | 'markup' | 'unknown' {
  if (startsWith(b, [0x4d, 0x5a]) || startsWith(b, [0x7f, 0x45, 0x4c, 0x46]) || startsWith(b, [0xca, 0xfe, 0xba, 0xbe])
    || startsWith(b, [0xfe, 0xed, 0xfa, 0xce]) || startsWith(b, [0xfe, 0xed, 0xfa, 0xcf]) || startsWith(b, [0xcf, 0xfa, 0xed, 0xfe])
    || startsWith(b, [0x23, 0x21])) return 'exe';
  if (startsWith(b, [0x50, 0x4b, 0x03, 0x04]) || startsWith(b, [0x52, 0x61, 0x72, 0x21]) || startsWith(b, [0x37, 0x7a, 0xbc, 0xaf])
    || startsWith(b, [0x1f, 0x8b]) || startsWith(b, [0xd0, 0xcf, 0x11, 0xe0])) return 'archive';
  if (ascii(b, 0, 1024).includes('%PDF-')) return 'pdf';
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (startsWith(b, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (ascii(b, 0, 4) === 'GIF8') return 'gif';
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') return 'webp';
  if (ascii(b, 4, 8) === 'ftyp' && /^(heic|heix|hevc|heim|heis|mif1|msf1|avif)$/.test(ascii(b, 8, 12))) return 'heic';
  const head = b.subarray(0, 8192);
  if (head.includes(0)) return 'unknown';
  const text = ascii(b, 0, 8192).toLowerCase();
  if (/<\s*(script|html|svg|iframe|object|embed)\b|<\?php|<\?xml[\s\S]*<svg/.test(text)) return 'markup';
  return 'text';
}

const PDF_DANGER: [RegExp, string][] = [
  [/\/JavaScript\b/, 'contains JavaScript'],
  [/\/JS\b/, 'contains JavaScript'],
  [/\/Launch\b/, 'tries to open other programs'],
  [/\/EmbeddedFiles?\b/, 'has files hidden inside it'],
  [/\/RichMedia\b/, 'contains Flash or other active content'],
  [/\/XFA\b/, 'contains an XFA form, which can run code'],
  [/\/SubmitForm\b/, 'sends data to the internet'],
  [/\/ImportData\b/, 'loads data from outside the file'],
];

/** PDF names can hide letters as #xx codes (/J#61vaScript); decode them before searching. */
const decodePdfNames = (s: string) => s.replace(/\/[^\s/<>[\]()]+/g, (n) => n.replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))));

export function scanFile(bytes: Uint8Array, declaredType: string): ScanResult {
  if (!bytes.length) return { ok: false, reason: 'The file is empty.' };
  const all = latin1(bytes);
  if (all.includes('EICAR-STANDARD-ANTIVIRUS-TEST-FILE')) return { ok: false, reason: 'It matches the antivirus test file.' };

  const kind = detect(bytes);
  if (kind === 'exe') return { ok: false, reason: 'It is a program, not a document.' };
  if (kind === 'archive') return { ok: false, reason: 'Zip, Office and other packed files aren’t accepted. Save it as a PDF instead.' };
  if (kind === 'markup') return { ok: false, reason: 'Web pages and SVG images can run code, so they aren’t accepted.' };
  if (kind === 'unknown') return { ok: false, reason: 'This file type isn’t recognised. Use PDF, a photo, or a text file.' };

  const t = (declaredType || '').toLowerCase().split(';')[0].trim();
  const claimed = t === 'application/pdf' ? 'pdf' : t.startsWith('image/') ? 'image' : t.startsWith('text/') ? 'text' : t === '' || t === 'application/octet-stream' ? 'any' : 'other';
  const actual = kind === 'pdf' ? 'pdf' : kind === 'text' ? 'text' : 'image';
  if (t === 'image/svg+xml') return { ok: false, reason: 'SVG images can run code, so they aren’t accepted.' };
  if (claimed === 'other' || (claimed !== 'any' && claimed !== actual)) {
    return { ok: false, reason: 'The file isn’t what its name says it is.' };
  }

  if (kind === 'pdf') {
    const s = decodePdfNames(all);
    for (const [re, why] of PDF_DANGER) if (re.test(s)) return { ok: false, reason: `This PDF ${why}.` };
  }
  return { ok: true, kind };
}

/** The content type to serve a scanned file with — from what it really is, not what it claimed. */
export const SAFE_CONTENT_TYPE: Record<FileKind, string> = {
  pdf: 'application/pdf', png: 'image/png', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic', text: 'text/plain; charset=utf-8',
};

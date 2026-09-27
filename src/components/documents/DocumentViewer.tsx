import { useEffect, useState } from 'react';
import { Download, FileText, Image as ImageIcon, ScanLine, FileHeart, ClipboardList } from 'lucide-react';
import type { MedicalDocument } from '../../types';
import { documentService, DOC_CATEGORY_LABEL } from '../../services';
import { fmtDate } from '../../lib/dates';
import { Button, ErrorState, Modal, Skeleton } from '../ui';

export const DOC_ICON = { report: ClipboardList, prescription: FileHeart, scan: ScanLine, image: ImageIcon, discharge: FileText, other: FileText };

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * Opens a document through the service (permission-checked and, for doctors,
 * logged). The file is shown via a temporary in-memory URL — never a public link.
 */
export function DocumentViewer({ docId, onClose }: { docId?: string; onClose: () => void }) {
  const [state, setState] = useState<{ doc?: MedicalDocument; url?: string; text?: string; error?: unknown }>({});
  useEffect(() => {
    if (!docId) return;
    let url: string | undefined;
    let cancelled = false;
    setState({});
    documentService.open(docId).then(async ({ doc, blob }) => {
      if (cancelled) return;
      url = URL.createObjectURL(blob);
      const text = doc.mimeType.startsWith('text/') ? await blob.text() : undefined;
      setState({ doc, url, text });
    }).catch((error) => !cancelled && setState({ error }));
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [docId]);

  const { doc, url, text, error } = state;
  return (
    <Modal open={!!docId} onClose={onClose} size="lg" title={doc?.name ?? 'Document'}
      description={doc ? `${DOC_CATEGORY_LABEL[doc.category]} · ${fmtDate(doc.date)} · ${formatBytes(doc.size)} · added by ${doc.uploadedBy.name}` : undefined}
      footer={doc && url ? <Button variant="primary" icon={Download} onClick={() => { const a = document.createElement('a'); a.href = url; a.download = doc.name; a.click(); }}>Download</Button> : undefined}>
      {error ? <ErrorState error={error} title="Unable to open this document" /> : !url || !doc ? (
        <Skeleton h={420} r={10} />
      ) : doc.mimeType === 'application/pdf' ? (
        <iframe className="viewer-frame" src={url} title={doc.name} />
      ) : doc.mimeType.startsWith('image/') ? (
        <img className="viewer-img" src={url} alt={doc.name} />
      ) : text !== undefined ? (
        <pre className="inset small" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{text}</pre>
      ) : (
        <div className="empty compact"><p>Preview isn’t available for this file type. Download it to open.</p></div>
      )}
    </Modal>
  );
}

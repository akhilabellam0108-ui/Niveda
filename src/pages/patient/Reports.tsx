import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Upload, FileText, Download, Trash2, Link2, Search, Lock } from 'lucide-react';
import type { DocumentCategory, MedicalRecord } from '@shared/types';
import { documentService, recordService, DOC_CATEGORY_LABEL, type DocumentView } from '../../services';
import { useLive, useDocumentTitle } from '../../state/hooks';
import { useToast } from '../../state/ToastContext';
import { brand } from '../../config/brand';
import { fmtDate } from '@shared/dates';
import { RECORD_TYPES, recordTitle } from '@shared/recordMeta';
import { Badge, Button, ConfirmDialog, EmptyState, ErrorState, Field, Input, Select, SkeletonList } from '../../components/ui';
import { DocumentViewer, DOC_ICON, formatBytes, downloadBlob } from '../../components/documents/DocumentViewer';
import { usePatientUI } from '../../components/layout/PatientShell';

export function ReportsPage() {
  useDocumentTitle(`Reports · ${brand.name}`);
  const ui = usePatientUI();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const docs = useLive(() => documentService.list(), []);
  const records = useLive(() => recordService.list(), []);
  const [cat, setCat] = useState<DocumentCategory | 'all'>('all');
  const [q, setQ] = useState('');
  const [del, setDel] = useState<DocumentView>();
  const [link, setLink] = useState<DocumentView>();
  const [linkTo, setLinkTo] = useState('');
  const viewing = params.get('doc') ?? undefined;
  const setViewing = (id?: string) => setParams((p) => { const n = new URLSearchParams(p); if (id) n.set('doc', id); else n.delete('doc'); return n; });

  const shown = useMemo(() => (docs.data ?? []).filter((d) => (cat === 'all' || d.category === cat) && (!q || `${d.name} ${d.recordLabel ?? ''}`.toLowerCase().includes(q.toLowerCase()))), [docs.data, cat, q]);
  const cats = useMemo(() => Object.keys(DOC_CATEGORY_LABEL).filter((c) => (docs.data ?? []).some((d) => d.category === c)) as DocumentCategory[], [docs.data]);

  const download = async (d: DocumentView) => {
    try {
      const { blob } = await documentService.open(d.id);
      downloadBlob(blob, d.name);
    } catch {
      toast('This document couldn’t be downloaded.', 'error');
    }
  };

  return (
    <>
      <div className="page-head">
        <div><h1>Reports & documents</h1><p>Lab reports, scans, prescriptions and discharge summaries. Linking a document to an entry puts it in the right place in your timeline.</p></div>
        <Button variant="primary" icon={Upload} onClick={() => ui.upload()}>Upload</Button>
      </div>
      {docs.error ? <ErrorState error={docs.error} title="Unable to load your reports" onRetry={docs.reload} /> : !docs.data ? <SkeletonList rows={4} /> : docs.data.length === 0 ? (
        <div className="card"><EmptyState icon={FileText} title="No documents yet" body="Upload reports, scans or prescriptions you already have. PDFs and photos both work." action={<Button variant="primary" icon={Upload} onClick={() => ui.upload()}>Upload a report</Button>} /></div>
      ) : (
        <>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <div className="input-wrap grow" style={{ minWidth: 200 }}><Search aria-hidden /><Input type="search" placeholder="Search documents" aria-label="Search documents" value={q} onChange={(e) => setQ(e.target.value)} /></div>
            <div className="chip-scroll">
              <button className="chip" aria-pressed={cat === 'all'} onClick={() => setCat('all')}>All <span className="count">{docs.data.length}</span></button>
              {cats.map((c) => <button key={c} className="chip" aria-pressed={cat === c} onClick={() => setCat(c)}>{DOC_CATEGORY_LABEL[c]}</button>)}
            </div>
          </div>
          {shown.length === 0 ? <div className="card"><EmptyState compact icon={Search} title="No matching documents" /></div> : (
            <div className="doc-grid">
              {shown.map((d) => {
                const Icon = DOC_ICON[d.category];
                const locked = d.uploadedBy.role === 'doctor';
                return (
                  <div key={d.id} className="doc-card" onClick={() => setViewing(d.id)}>
                    <div className="doc-thumb"><Icon aria-hidden /></div>
                    <div className="stack" style={{ '--gap': '4px' } as React.CSSProperties}>
                      <button className="rec-open truncate" onClick={(e) => { e.stopPropagation(); setViewing(d.id); }}>{d.name}</button>
                      <div className="row-wrap"><Badge>{DOC_CATEGORY_LABEL[d.category]}</Badge><span className="xs subtle">{fmtDate(d.date)} · {formatBytes(d.size)}</span></div>
                      <div className="xs muted truncate">{d.recordLabel ? <><Link2 size={11} aria-hidden /> {d.recordLabel}</> : 'Not linked to an entry'}</div>
                      <div className="xs subtle truncate">Added by {d.uploadedBy.role === 'patient' ? 'you' : d.uploadedBy.name}</div>
                    </div>
                    <div className="row" style={{ '--gap': '4px', marginTop: 'auto' } as React.CSSProperties} onClick={(e) => e.stopPropagation()}>
                      <Button size="sm" variant="ghost" icon={Download} onClick={() => download(d)}>Download</Button>
                      <Button size="sm" variant="ghost" icon={Link2} iconOnly aria-label={`Link ${d.name} to an entry`} onClick={() => { setLinkTo(d.recordId ?? ''); setLink(d); }} />
                      {locked ? <span className="xs subtle row" style={{ marginLeft: 'auto', '--gap': '4px' } as React.CSSProperties} title="Added by a doctor — stays with its record"><Lock size={12} aria-hidden /></span>
                        : <Button size="sm" variant="ghost" icon={Trash2} iconOnly aria-label={`Delete ${d.name}`} style={{ marginLeft: 'auto' }} onClick={() => setDel(d)} />}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
      <DocumentViewer docId={viewing} onClose={() => setViewing(undefined)} />
      <ConfirmDialog open={!!del} onClose={() => setDel(undefined)} danger confirmLabel="Delete document" title="Delete this document?"
        body={<>“{del?.name}” will be removed from your record{del?.recordLabel ? ` and from ${del.recordLabel}` : ''}. The deletion is recorded in your access log. This can’t be undone.</>}
        onConfirm={async () => { await documentService.remove(del!.id); toast('Document deleted'); }} />
      <ConfirmDialog open={!!link} onClose={() => setLink(undefined)} confirmLabel="Save link" title="Link to an entry"
        body="Choose the visit, test or other entry this document belongs to."
        onConfirm={async () => { await documentService.attach(link!.id, linkTo || undefined); toast(linkTo ? 'Document linked' : 'Link removed'); }}>
        <Field label="Entry">{(p) => <Select {...p} value={linkTo} onChange={(e) => setLinkTo(e.target.value)} placeholder="Not linked" options={(records.data ?? []).map((r: MedicalRecord) => ({ value: r.id, label: `${fmtDate(r.date)} · ${RECORD_TYPES[r.type].label}: ${recordTitle(r)}` }))} />}</Field>
      </ConfirmDialog>
    </>
  );
}

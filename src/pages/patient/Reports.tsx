import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Upload, FileText, Download, Trash2, Link2, Search, Lock, ShieldAlert } from 'lucide-react';
import type { DocumentCategory, MedicalRecord } from '../../types';
import { documentService, recordService, DOC_CATEGORY_LABEL, type DocumentView } from '../../services';
import { useLive, useDocumentTitle } from '../../state/hooks';
import { useToast } from '../../state/ToastContext';
import { brand } from '../../config/brand';
import { fmtDate } from '../../lib/dates';
import { RECORD_TYPES, recordTitle } from '../../lib/recordMeta';
import { Badge, Button, ConfirmDialog, EmptyState, ErrorState, Field, Input, Select, SkeletonList } from '../../components/ui';
import { DocumentViewer, DOC_ICON, formatBytes, downloadBlob } from '../../components/documents/DocumentViewer';
import { usePatientUI } from '../../components/layout/PatientShell';

import { t } from '../../i18n';
export function ReportsPage() {
  useDocumentTitle(`${t('Reports')} · ${brand.name}`);
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
      toast(t('This document couldn’t be downloaded.'), 'error');
    }
  };

  return (
    <>
      <div className="page-head">
        <div><h1>{t('Reports & documents')}</h1><p>{t('Lab reports, scans, prescriptions and discharge summaries. Linking a document to an entry puts it in the right place in your timeline.')}</p></div>
        <Button variant="primary" icon={Upload} onClick={() => ui.upload()}>{t('Upload')}</Button>
      </div>
      {docs.error ? <ErrorState error={docs.error} title={t('Unable to load your reports')} onRetry={docs.reload} /> : !docs.data ? <SkeletonList rows={4} /> : docs.data.length === 0 ? (
        <div className="card"><EmptyState icon={FileText} title={t('No documents yet')} body={t('Upload reports, scans or prescriptions you already have. PDFs and photos both work.')} action={<Button variant="primary" icon={Upload} onClick={() => ui.upload()}>{t('Upload a report')}</Button>} /></div>
      ) : (
        <>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <div className="input-wrap grow" style={{ minWidth: 200 }}><Search aria-hidden /><Input type="search" placeholder={t('Search documents')} aria-label={t('Search documents')} value={q} onChange={(e) => setQ(e.target.value)} /></div>
            <div className="chip-scroll">
              <button className="chip" aria-pressed={cat === 'all'} onClick={() => setCat('all')}>{t('All')}{' '}<span className="count">{docs.data.length}</span></button>
              {cats.map((c) => <button key={c} className="chip" aria-pressed={cat === c} onClick={() => setCat(c)}>{DOC_CATEGORY_LABEL[c]}</button>)}
            </div>
          </div>
          {shown.length === 0 ? <div className="card"><EmptyState compact icon={Search} title={t('No matching documents')} /></div> : (
            <div className="doc-grid">
              {shown.map((d) => {
                const Icon = DOC_ICON[d.category];
                const locked = d.uploadedBy.role === 'doctor';
                return (
                  <div key={d.id} className="doc-card" onClick={() => setViewing(d.id)}>
                    <div className="doc-thumb"><Icon aria-hidden /></div>
                    <div className="stack" style={{ '--gap': '4px' } as React.CSSProperties}>
                      <button className="rec-open truncate" onClick={(e) => { e.stopPropagation(); setViewing(d.id); }}>{d.name}</button>
                      <div className="row-wrap">{d.scanStatus === 'blocked' && <Badge tone="danger" icon={ShieldAlert}>{t('Blocked')}</Badge>}<Badge>{DOC_CATEGORY_LABEL[d.category]}</Badge><span className="xs subtle">{fmtDate(d.date)} · {formatBytes(d.size)}</span></div>
                      <div className="xs muted truncate">{d.recordLabel ? <><Link2 size={11} aria-hidden /> {d.recordLabel}</> : t('Not linked to an entry')}</div>
                      <div className="xs subtle truncate">{d.uploadedBy.role === 'patient' ? t('Added by you') : t('Added by {name}', { name: d.uploadedBy.name })}</div>
                    </div>
                    <div className="row" style={{ '--gap': '4px', marginTop: 'auto' } as React.CSSProperties} onClick={(e) => e.stopPropagation()}>
                      <Button size="sm" variant="ghost" icon={Download} onClick={() => download(d)}>{t('Download')}</Button>
                      <Button size="sm" variant="ghost" icon={Link2} iconOnly aria-label={t('Link {name} to an entry', { name: d.name })} onClick={() => { setLinkTo(d.recordId ?? ''); setLink(d); }} />
                      {locked ? <span className="xs subtle row" style={{ marginLeft: 'auto', '--gap': '4px' } as React.CSSProperties} title={t('Added by a doctor — stays with its record')}><Lock size={12} aria-hidden /></span>
                        : <Button size="sm" variant="ghost" icon={Trash2} iconOnly aria-label={t('Delete {name}', { name: d.name })} style={{ marginLeft: 'auto' }} onClick={() => setDel(d)} />}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
      <DocumentViewer docId={viewing} onClose={() => setViewing(undefined)} />
      <ConfirmDialog open={!!del} onClose={() => setDel(undefined)} danger confirmLabel={t('Delete document')} title={t('Delete this document?')}
        body={del?.recordLabel ? t('“{name}” will be removed from your record and from {entry}. The deletion is recorded in your access log. This can’t be undone.', { name: del?.name, entry: del.recordLabel }) : t('“{name}” will be removed from your record. The deletion is recorded in your access log. This can’t be undone.', { name: del?.name })}
        onConfirm={async () => { await documentService.remove(del!.id); toast(t('Document deleted')); }} />
      <ConfirmDialog open={!!link} onClose={() => setLink(undefined)} confirmLabel={t('Save link')} title={t('Link to an entry')}
        body={t('Choose the visit, test or other entry this document belongs to.')}
        onConfirm={async () => { await documentService.attach(link!.id, linkTo || undefined); toast(linkTo ? t('Document linked') : t('Link removed')); }}>
        <Field label={t('Entry')}>{(p) => <Select {...p} value={linkTo} onChange={(e) => setLinkTo(e.target.value)} placeholder={t('Not linked')} options={(records.data ?? []).map((r: MedicalRecord) => ({ value: r.id, label: `${fmtDate(r.date)} · ${t(RECORD_TYPES[r.type].label)}: ${recordTitle(r)}` }))} />}</Field>
      </ConfirmDialog>
    </>
  );
}

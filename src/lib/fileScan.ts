// The same check the server runs (supabase/functions/document-access/scan.ts), used
// before uploading so people hear about a refused file straight away.
export { scanFile, SAFE_CONTENT_TYPE, type ScanResult, type FileKind } from '../../supabase/functions/document-access/scan';

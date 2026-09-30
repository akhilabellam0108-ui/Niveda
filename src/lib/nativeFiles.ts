/** Saving files in the Android app: write to the app's cache, then offer the share menu (Files, Drive, WhatsApp…). */
import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

export const isNativeApp = () => Capacitor.isNativePlatform();

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export async function shareFile(blob: Blob, filename: string): Promise<void> {
  const safe = filename.replace(/[^\w.\- ]+/g, '_');
  const { uri } = await Filesystem.writeFile({ path: safe, data: await toBase64(blob), directory: Directory.Cache });
  await Share.share({ title: safe, files: [uri], dialogTitle: 'Save or send' });
}

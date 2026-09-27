import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Camera, CameraOff } from 'lucide-react';
import { Button } from '../ui';

/** Renders a QR code for an identifier (patient ID or doctor access code). */
export function QrCode({ value, size = 168, label }: { value: string; size?: number; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) void QRCode.toCanvas(ref.current, value, { width: size, margin: 0, color: { dark: '#10201b', light: '#ffffff' } });
  }, [value, size]);
  return <div className="qr-box"><canvas ref={ref} role="img" aria-label={label} /></div>;
}

type Detector = { detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]> };

/**
 * Scans a QR code with the camera using the browser's BarcodeDetector where
 * supported (Chrome on Android, some desktops). Falls back to manual entry.
 */
export function QrScanner({ onResult }: { onResult: (text: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<'idle' | 'starting' | 'scanning' | 'unsupported' | 'denied'>('idle');

  useEffect(() => {
    if (state !== 'starting') return;
    let stream: MediaStream | undefined;
    let raf = 0;
    let stopped = false;
    const Ctor = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
    if (!Ctor || !navigator.mediaDevices?.getUserMedia) { setState('unsupported'); return; }
    const detector = new Ctor({ formats: ['qr_code'] });
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }).then((s) => {
      if (stopped) { s.getTracks().forEach((t) => t.stop()); return; }
      stream = s;
      if (video.current) { video.current.srcObject = s; void video.current.play(); }
      setState('scanning');
      const tick = async () => {
        if (stopped || !video.current) return;
        try {
          const codes = video.current.readyState >= 2 ? await detector.detect(video.current) : [];
          if (codes[0]?.rawValue) { onResult(codes[0].rawValue); return; }
        } catch { /* keep scanning */ }
        raf = requestAnimationFrame(() => void tick());
      };
      void tick();
    }).catch(() => setState('denied'));
    return () => { stopped = true; cancelAnimationFrame(raf); stream?.getTracks().forEach((t) => t.stop()); };
  }, [state, onResult]);

  if (state === 'unsupported' || state === 'denied') {
    return (
      <div className="alert alert-warn">
        <CameraOff aria-hidden />
        <div>{state === 'denied' ? 'Camera access was blocked.' : 'QR scanning isn’t supported in this browser.'} Type the code shown under the doctor’s QR instead.</div>
      </div>
    );
  }
  return (
    <div className="stack" style={{ '--gap': '10px', alignItems: 'center' } as React.CSSProperties}>
      <div className="scan-frame">
        {state === 'scanning' ? <video ref={video} muted playsInline aria-label="Camera preview" /> : <Camera color="#7fd3bf" aria-hidden />}
        <div className="scan-line" />
      </div>
      {state === 'idle' && <Button variant="primary" icon={Camera} onClick={() => setState('starting')}>Start camera</Button>}
      {state !== 'idle' && <p className="xs subtle">Point your camera at the QR code on your doctor’s screen or desk card.</p>}
    </div>
  );
}

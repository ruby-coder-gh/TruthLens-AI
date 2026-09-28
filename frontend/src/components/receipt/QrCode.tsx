import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { clsx } from 'clsx';

interface QrCodeProps {
  /** URL or text to encode. */
  value: string;
  size?: number;
  className?: string;
}

/**
 * Renders `value` as a scannable QR code.
 *
 * `qrcode`'s browser build resolves `toDataURL` through a canvas — generation
 * is async, so callers see a shimmer placeholder for one tick. Fixed dark ink
 * on an opaque white tile regardless of theme/print, so the code still scans
 * in dark mode and on a printed page.
 */
export function QrCode({ value, size = 152, className }: QrCodeProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(value, {
      width: size,
      margin: 1,
      color: { dark: '#14171A', light: '#FFFFFF' },
    })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [value, size]);

  if (!dataUrl) {
    return (
      <div
        className={clsx('shimmer rounded-control', className)}
        style={{ width: size, height: size }}
        aria-hidden="true"
      />
    );
  }

  return (
    <img
      src={dataUrl}
      width={size}
      height={size}
      alt="QR code linking to this receipt"
      className={clsx('rounded-control border border-border bg-white p-2', className)}
    />
  );
}

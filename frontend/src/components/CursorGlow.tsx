import { useEffect, useRef } from 'react';

/**
 * Subtle radial gradient that follows the cursor.
 * Adds immersive depth to dark cinematic theme.
 */
export default function CursorGlow() {
  const ref = useRef<HTMLDivElement>(null);
  const frame = useRef(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let mx = -1000, my = -1000; // start offscreen

    const onMove = (e: MouseEvent) => {
      mx = e.clientX;
      my = e.clientY;
    };

    const onLeave = () => {
      mx = -1000;
      my = -1000;
    };

    const tick = () => {
      frame.current = requestAnimationFrame(tick);
      el!.style.transform = `translate(${mx - 200}px, ${my - 200}px)`;
      el!.style.opacity = mx > 0 ? '1' : '0';
    };

    document.addEventListener('mousemove', onMove, { passive: true });
    document.addEventListener('mouseleave', onLeave, { passive: true });
    frame.current = requestAnimationFrame(tick);

    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseleave', onLeave);
      cancelAnimationFrame(frame.current);
    };
  }, []);

  return <div ref={ref} id="cursorGlow" aria-hidden="true" />;
}

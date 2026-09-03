interface ParticleFieldProps {
  count?: number;
  color?: string;
  className?: string;
}

/**
 * A faint decorative wash.
 *
 * This used to be a canvas that ran a `requestAnimationFrame` loop forever,
 * drifting `count` glowing dots and drawing an O(n²) proximity mesh between
 * them — a Midnight-era effect tuned for a near-black ground. Grounded Glass
 * takes its depth from the static ruled substrate and two fixed washes, never
 * from live motion, and on a light ground a drifting indigo mesh reads as
 * dirt on the screen rather than as atmosphere.
 *
 * So the animation is gone. What survives is the *intent* — a soft off-axis
 * lift behind a panel — expressed in the ground's own language: two static
 * radial washes. No canvas, no rAF, no resize listener, nothing to clean up.
 * `count` now scales the wash strength and `color` its hue, so both existing
 * call sites keep their meaning and the default flips with the theme.
 */
export default function ParticleField({
  count = 30,
  color = 'var(--color-primary)',
  className,
}: ParticleFieldProps) {
  // 30 dots read as "light"; 60+ read as "dense". Map that to 6%–14% alpha.
  const strength = Math.min(Math.max(count, 0), 60) / 60;
  const wash = `color-mix(in srgb, ${color} ${(6 + 8 * strength).toFixed(1)}%, transparent)`;

  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 ${className ?? ''}`}
      style={{
        backgroundImage: [
          `radial-gradient(62% 56% at 16% 6%, ${wash}, transparent 68%)`,
          `radial-gradient(54% 50% at 86% 94%, ${wash}, transparent 68%)`,
        ].join(', '),
      }}
    />
  );
}

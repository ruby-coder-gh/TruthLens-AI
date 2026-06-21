import { useEffect, useRef, useState } from 'react';
import { motion, useInView } from 'framer-motion';
import { clsx } from 'clsx';

interface AnimatedCounterProps {
  value: number;
  suffix?: string;
  prefix?: string;
  duration?: number;
  decimals?: number;
  className?: string;
  label?: string;
  icon?: React.ReactNode;
  formatter?: (value: number) => string;
}

export default function AnimatedCounter({
  value,
  suffix = '',
  prefix = '',
  duration = 2,
  decimals = 0,
  className,
  label,
  icon,
  formatter,
}: AnimatedCounterProps) {
  const [displayValue, setDisplayValue] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: '-50px' });
  const hasAnimated = useRef(false);

  useEffect(() => {
    if (!isInView || hasAnimated.current) return;
    hasAnimated.current = true;

    const startTime = Date.now();
    const endTime = startTime + duration * 1000;

    const tick = () => {
      const now = Date.now();
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / (duration * 1000), 1);

      // Ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = eased * value;

      setDisplayValue(current);

      if (now < endTime) {
        requestAnimationFrame(tick);
      } else {
        setDisplayValue(value);
      }
    };

    requestAnimationFrame(tick);
  }, [isInView, value, duration]);

  const formatted = formatter
    ? formatter(displayValue)
    : displayValue.toFixed(decimals);

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0.99, y: 12 }}
      animate={isInView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className={clsx('flex flex-col items-center', className)}
    >
      <div className="flex items-baseline gap-0.5">
        {icon && <span className="text-text-dim mr-1">{icon}</span>}
        <span className="text-3xl font-bold tracking-tight text-text">
          {prefix}
          {formatted}
          {suffix}
        </span>
      </div>
      {label && (
        <span className="mt-1 text-xs font-medium text-text-dim uppercase tracking-wider">
          {label}
        </span>
      )}
    </motion.div>
  );
}

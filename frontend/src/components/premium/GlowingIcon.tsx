import { motion } from 'framer-motion';
import { clsx } from 'clsx';

interface GlowingIconProps {
  icon: React.ReactNode;
  active?: boolean;
  color?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  onClick?: () => void;
}

function ParticleBurst({ color }: { color: string }) {
  // Deterministic burst directions (6 evenly-spread radial offsets) — pure render.
  return (
    <span className="absolute inset-0 pointer-events-none" aria-hidden="true">
      {Array.from({ length: 6 }).map((_, i) => {
        const angle = (i / 6) * Math.PI * 2;
        const dx = Math.cos(angle) * 18;
        const dy = Math.sin(angle) * 18;
        return (
          <motion.span
            key={i}
            className="absolute w-1 h-1 rounded-full"
            style={{ background: color, left: '50%', top: '50%' }}
            initial={{ x: 0, y: 0, opacity: 0.99 }}
            animate={{
              x: [0, dx],
              y: [0, dy],
              opacity: [0.99, 0],
              scale: [1, 0],
            }}
            transition={{ duration: 1.2, repeat: Infinity, repeatDelay: 2 + i * 0.3, ease: 'easeOut' }}
          />
        );
      })}
    </span>
  );
}

export default function GlowingIcon({
  icon,
  active = false,
  color = '#e8c15a',
  size = 'md',
  className,
  onClick,
}: GlowingIconProps) {
  const sizeMap = { sm: 28, md: 36, lg: 44 };
  const iconSize = sizeMap[size];

  return (
    <motion.button
      type="button"
      onClick={onClick}
      className={clsx(
        'relative flex items-center justify-center rounded-xl transition-all duration-300',
        'cursor-pointer',
        className,
      )}
      style={{ width: iconSize, height: iconSize }}
      whileHover={{ scale: 1.1 }}
      whileTap={{ scale: 0.95 }}
      animate={
        active
          ? {
              boxShadow: [
                `0 0 8px ${color}40, 0 0 16px ${color}20`,
                `0 0 12px ${color}60, 0 0 24px ${color}30`,
                `0 0 8px ${color}40, 0 0 16px ${color}20`,
              ],
            }
          : {
              boxShadow: [
                `0 0 0px ${color}00`,
                `0 0 4px ${color}10`,
                `0 0 0px ${color}00`,
              ],
            }
      }
      transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
    >
      {/* Active background glow */}
      {active && (
        <motion.div
          className="absolute inset-0 rounded-xl"
          style={{
            background: `radial-gradient(circle, ${color}20, transparent)`,
            border: `1px solid ${color}40`,
          }}
          animate={{ opacity: [0.6, 1, 0.6] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}

      {/* Hover glow ring */}
      <motion.div
        className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100"
        style={{
          background: `radial-gradient(circle at center, ${color}15, transparent 70%)`,
        }}
        whileHover={{ opacity: 1 }}
        transition={{ duration: 0.3 }}
      />

      {/* Floating particles (active only) */}
      {active && <ParticleBurst color={color} />}

      {/* Icon */}
      <motion.span
        className="relative z-10 flex items-center justify-center"
        style={{
          filter: active ? `drop-shadow(0 0 6px ${color}60)` : 'none',
        }}
        animate={active ? { scale: [1, 1.05, 1] } : {}}
        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
      >
        {icon}
      </motion.span>
    </motion.button>
  );
}

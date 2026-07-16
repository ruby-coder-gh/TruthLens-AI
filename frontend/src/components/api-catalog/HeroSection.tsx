import { useRef, useEffect } from 'react';
import { motion } from 'framer-motion';

function ParticleField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;
    const particles: { x: number; y: number; vx: number; vy: number; size: number; alpha: number }[] = [];

    const resize = () => {
      if (!canvas) return;
      canvas.width = canvas.parentElement?.clientWidth || 600;
      canvas.height = canvas.parentElement?.clientHeight || 400;
    };
    resize();
    window.addEventListener('resize', resize);

    // Create particles
    const count = 50;
    for (let i = 0; i < count; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.5,
        vy: (Math.random() - 0.5) * 0.5,
        size: Math.random() * 2 + 0.5,
        alpha: Math.random() * 0.5 + 0.1,
      });
    }

    const animate = () => {
      if (!ctx || !canvas) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      particles.forEach((p, i) => {
        p.x += p.vx;
        p.y += p.vy;

        if (p.x < 0) p.x = canvas.width;
        if (p.x > canvas.width) p.x = 0;
        if (p.y < 0) p.y = canvas.height;
        if (p.y > canvas.height) p.y = 0;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba( 99,  102,  241, ${p.alpha})`;
        ctx.fill();

        // Draw connections
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[j].x - p.x;
          const dy = particles[j].y - p.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 120) {
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.strokeStyle = `rgba( 99,  102,  241, ${0.06 * (1 - dist / 120)})`;
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
      });

      animationId = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 pointer-events-none"
      aria-hidden="true"
    />
  );
}

function FloatingCube() {
  return (
    <motion.div
      className="relative w-20 h-20 sm:w-24 sm:h-24"
      animate={{ rotateY: 360, rotateX: 15 }}
      transition={{ duration: 12, repeat: Infinity, ease: 'linear' }}
      style={{ transformStyle: 'preserve-3d' }}
    >
      {/* Cube faces */}
      {[
        { translate: 'translateZ(40px)', bg: 'rgba(99,102,241,0.15)', border: 'rgba(99,102,241,0.4)' },
        { translate: 'translateZ(-40px)', bg: 'rgba(52,211,153,0.1)', border: 'rgba(52,211,153,0.3)' },
        { translate: 'rotateY(90deg) translateZ(40px)', bg: 'rgba(99,102,241,0.12)', border: 'rgba(99,102,241,0.35)' },
        { translate: 'rotateY(90deg) translateZ(-40px)', bg: 'rgba(99,102,241,0.1)', border: 'rgba(99,102,241,0.35)' },
        { translate: 'rotateX(90deg) translateZ(40px)', bg: 'rgba(52,211,153,0.12)', border: 'rgba(52,211,153,0.35)' },
        { translate: 'rotateX(90deg) translateZ(-40px)', bg: 'rgba(99,102,241,0.1)', border: 'rgba(99,102,241,0.3)' },
      ].map((face, i) => (
        <div
          key={i}
          className="absolute inset-0 rounded-xl backdrop-blur-sm border"
          style={{
            transform: face.translate,
            background: face.bg,
            borderColor: face.border,
            boxShadow: `0 0 20px ${face.bg}`,
          }}
        />
      ))}

      {/* Inner glow */}
      <div
        className="absolute inset-0 rounded-xl"
        style={{
          background: 'radial-gradient(circle, rgba(99,102,241,0.2), transparent)',
          transform: 'translateZ(20px)',
          filter: 'blur(4px)',
        }}
      />
    </motion.div>
  );
}

export default function HeroSection() {
  return (
    <div className="relative overflow-hidden rounded-2xl glass border border-glass-border min-h-[220px]">
      <ParticleField />

      {/* Aurora gradient overlay */}
      <div
        className="absolute inset-0 opacity-30"
        style={{
          background:
            'radial-gradient(ellipse 80% 60% at 30% 30%, rgba(99,102,241,0.15), transparent), radial-gradient(ellipse 60% 80% at 70% 70%, rgba(52,211,153,0.1), transparent), radial-gradient(ellipse 50% 50% at 50% 50%, rgba(99,102,241,0.08), transparent)',
        }}
      />

      <div className="relative z-10 flex items-center gap-6 sm:gap-10 p-6 sm:p-8">
        {/* Cube */}
        <motion.div
          initial={{ opacity: 0.99, scale: 0.8, rotateY: -20 }}
          animate={{ opacity: 1, scale: 1, rotateY: 0 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="shrink-0"
        >
          <FloatingCube />
        </motion.div>

        {/* Text */}
        <div className="flex-1 min-w-0">
          <motion.div
            initial={{ opacity: 0.99, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.1 }}
          >
            <div className="flex items-center gap-3 mb-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 border border-primary/30 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-primary-soft">
                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                API v1.0
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-green-500/15 border border-green-500/30 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-green">
                <span className="w-1.5 h-1.5 rounded-full bg-green animate-pulse-dot" />
                Operational
              </span>
            </div>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0.99, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.15 }}
            className="text-2xl sm:text-3xl lg:text-4xl font-bold text-text"
          >
            API <span className="gradient-text">Reference</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0.99, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.2 }}
            className="mt-2 text-sm sm:text-base text-text-muted max-w-xl leading-relaxed"
          >
            Complete API documentation for the TruthLens AI platform.
            Explore endpoints, test requests, and monitor real-time pipeline status.
          </motion.p>
        </div>
      </div>
    </div>
  );
}

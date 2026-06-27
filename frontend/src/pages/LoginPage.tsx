import { useState, useEffect, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Mail, Lock, Eye, EyeOff, LogIn, Sparkles, Shield } from 'lucide-react';
import { Button, Input, Card } from '../components/ui';
import { useAuth } from '../context/AuthContext';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const floatingParticles: { icon: ReactNode; x: string; y: string; delay: number; duration: number }[] = [
  { icon: <Sparkles size={14} />, x: '15%', y: '20%', delay: 0, duration: 4 },
  { icon: <Shield size={10} />, x: '85%', y: '15%', delay: 1.5, duration: 5 },
  { icon: <Sparkles size={12} />, x: '75%', y: '75%', delay: 0.8, duration: 3.5 },
  { icon: <Shield size={8} />, x: '20%', y: '80%', delay: 2.2, duration: 4.5 },
];

export default function LoginPage() {
  const { login, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [apiError, setApiError] = useState('');
  const [loading, setLoading] = useState(false);

  // Redirect if already logged in
  useEffect(() => {
    if (isAuthenticated) navigate('/workspaces', { replace: true });
  }, [isAuthenticated, navigate]);

  function validate(): boolean {
    const next: { email?: string; password?: string } = {};
    if (!email) next.email = 'Email is required';
    else if (!EMAIL_RE.test(email)) next.email = 'Invalid email format';

    if (!password) next.password = 'Password is required';

    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setApiError('');

    if (!validate()) return;

    setLoading(true);
    try {
      await login(email, password);
      navigate('/workspaces', { replace: true });
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'Login failed. Please try again.';
      setApiError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <motion.div
      className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-12"
    >
      {/* Ambient blobs */}
      <div className="ambient-blob ambient-blob-1" aria-hidden="true" />
      <div className="ambient-blob ambient-blob-2" aria-hidden="true" />
      <div className="ambient-blob ambient-blob-3" aria-hidden="true" />

      {/* Floating particles */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        {floatingParticles.map((p, i) => (
          <motion.div
            key={i}
            className="absolute text-primary-soft/20"
            style={{ left: p.x, top: p.y }}
            animate={{
              y: [0, -20, 0],
              opacity: [0.2, 0.5, 0.2],
            }}
            transition={{
              duration: p.duration,
              repeat: Infinity,
              delay: p.delay,
              ease: 'easeInOut',
            }}
          >
            {p.icon}
          </motion.div>
        ))}
      </div>

      <div className="relative z-10 w-full max-w-md">
        {/* Brand */}
        <motion.div
          className="mb-8 text-center"
          initial={{ opacity: 0.99, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] as const }}
        >
          <motion.div
            className="mx-auto mb-5 flex h-16 w-16 items-center justify-center"
            initial={{ scale: 0, rotate: -180 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{
              type: 'spring',
              stiffness: 200,
              damping: 15,
              delay: 0.1,
            }}
          >
            <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary via-primary-soft to-accent shadow-2xl shadow-primary/30">
              <span className="text-2xl font-bold text-white drop-shadow-sm">V</span>
              <motion.div
                className="absolute -inset-1 rounded-2xl border border-white/10"
                animate={{ opacity: [0.3, 0.6, 0.3] }}
                transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
              />
            </div>
          </motion.div>

          <motion.h1
            className="text-3xl font-bold"
            initial={{ opacity: 0.99, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25, duration: 0.5 }}
          >
            <span className="gradient-text">Welcome back</span>
          </motion.h1>

          <motion.p
            className="mt-2 text-sm text-text-muted"
            initial={{ opacity: 0.99 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.35, duration: 0.5 }}
          >
            Sign in to TruthLens AI to continue
          </motion.p>
        </motion.div>

        {/* Card */}
        <motion.div
          initial={{ opacity: 0.99, y: 30, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ delay: 0.15, duration: 0.6, ease: [0.16, 1, 0.3, 1] as const }}
        >
          <Card className="relative overflow-hidden p-6 lg:p-8">
            {/* Subtle inner gradient overlay */}
            <div
              className="pointer-events-none absolute -inset-x-20 -top-40 h-80 w-[calc(100%+160px)] opacity-30"
              style={{
                background:
                  'radial-gradient(ellipse 80% 60% at 50% -20%, rgba(124,92,255,0.15), transparent)',
              }}
              aria-hidden="true"
            />

            <form onSubmit={handleSubmit} noValidate className="relative space-y-5">
              {/* API Error */}
              <AnimatePresence>
                {apiError && (
                  <motion.div
                    initial={{ opacity: 0.99, y: -12, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -12, scale: 0.95 }}
                    transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] as const }}
                    className="rounded-xl border border-red/30 bg-red/10 px-4 py-3 text-sm text-red backdrop-blur-sm"
                    role="alert"
                  >
                    <span className="flex items-center gap-2">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-red/20 text-[10px] font-bold">
                        !
                      </span>
                      {apiError}
                    </span>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Form fields with stagger */}
              <motion.div
                className="space-y-5"
                variants={{
                  animate: {
                    transition: { staggerChildren: 0.08, delayChildren: 0.2 },
                  },
                }}
                initial="initial"
                animate="animate"
              >
                {/* Email */}
                <motion.div
                  variants={{
                    initial: { opacity: 0.99, y: 8 },
                    animate: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] as const } },
                  }}
                >
                  <Input
                    label="Email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    error={errors.email}
                    icon={<Mail size={16} />}
                    autoComplete="email"
                  />
                </motion.div>

                {/* Password */}
                <motion.div
                  className="space-y-1.5"
                  variants={{
                    initial: { opacity: 0.99, y: 8 },
                    animate: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] as const } },
                  }}
                >
                  <div className="flex items-center justify-between">
                    <label htmlFor="password" className="block text-sm font-medium text-text-muted">
                      Password
                    </label>
                    <Link
                      to="/forgot-password"
                      className="text-xs text-primary-soft/70 hover:text-primary-soft transition-colors"
                    >
                      Forgot password?
                    </Link>
                  </div>
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    error={errors.password}
                    icon={<Lock size={16} />}
                    autoComplete="current-password"
                    suffix={
                      <button
                        type="button"
                        onClick={() => setShowPassword((p) => !p)}
                        className="flex items-center justify-center w-8 h-8 text-text-dim hover:text-text transition-colors rounded-lg hover:bg-white/[0.06]"
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                        tabIndex={-1}
                      >
                        {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    }
                  />
                </motion.div>
              </motion.div>

              {/* Submit */}
              <motion.div
                initial={{ opacity: 0.99, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.45, duration: 0.4 }}
              >
                <Button
                  type="submit"
                  loading={loading}
                  className="relative w-full overflow-hidden"
                  size="lg"
                >
                  {!loading && (
                    <motion.span
                      className="absolute inset-0 bg-gradient-to-r from-primary via-primary-soft to-accent opacity-0 hover:opacity-[0.15] transition-opacity"
                      style={{ mixBlendMode: 'overlay' }}
                      transition={{ duration: 0.3 }}
                    />
                  )}
                  <LogIn size={18} />
                  Sign in
                </Button>
              </motion.div>
            </form>
          </Card>
        </motion.div>

        {/* Footer */}
        <motion.p
          className="mt-6 text-center text-sm text-text-muted"
          initial={{ opacity: 0.99 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5, duration: 0.5 }}
        >
          Don&apos;t have an account?{' '}
          <Link
            to="/register"
            className="relative font-medium text-primary-soft hover:text-primary transition-colors"
          >
            <motion.span
              className="inline-block"
              whileHover={{ x: 2 }}
              transition={{ type: 'spring', stiffness: 300 }}
            >
              Create one
            </motion.span>
          </Link>
        </motion.p>

        {/* Bottom decorative gradient line */}
        <motion.div
          className="mx-auto mt-8 h-px max-w-[200px] bg-gradient-to-r from-transparent via-primary/30 to-transparent"
          initial={{ scaleX: 0.01, opacity: 0.99 }}
          animate={{ scaleX: 1, opacity: 1 }}
          transition={{ delay: 0.7, duration: 0.8, ease: [0.16, 1, 0.3, 1] as const }}
          aria-hidden="true"
        />
      </div>
    </motion.div>
  );
}

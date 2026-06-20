import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Mail, Lock, User, Eye, EyeOff, UserPlus, Sparkles, Shield, Check } from 'lucide-react';
import { Button, Input, Card } from '../components/ui';
import { useAuth } from '../context/AuthContext';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_REQUIREMENTS = [
  { label: 'At least 8 characters', test: (v: string) => v.length >= 8 },
  { label: 'One uppercase letter', test: (v: string) => /[A-Z]/.test(v) },
  { label: 'One digit', test: (v: string) => /\d/.test(v) },
];

const floatingParticles: { icon: ReactNode; x: string; y: string; delay: number; duration: number }[] = [
  { icon: <Sparkles size={14} />, x: '15%', y: '25%', delay: 0, duration: 4 },
  { icon: <Shield size={10} />, x: '80%', y: '20%', delay: 1.5, duration: 5 },
  { icon: <Sparkles size={12} />, x: '70%', y: '70%', delay: 0.8, duration: 3.5 },
  { icon: <Shield size={8} />, x: '25%', y: '75%', delay: 2.2, duration: 4.5 },
  { icon: <Sparkles size={10} />, x: '50%', y: '10%', delay: 1, duration: 4.2 },
];

export default function RegisterPage() {
  const { register, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<
    Record<string, string>
  >({});
  const [apiError, setApiError] = useState('');
  const [loading, setLoading] = useState(false);

  // Redirect if already logged in
  if (isAuthenticated) {
    navigate('/workspaces', { replace: true });
  }

  function validate(): boolean {
    const next: Record<string, string> = {};

    if (!username.trim()) next.username = 'Username is required';
    else if (username.trim().length < 3)
      next.username = 'Username must be at least 3 characters';

    if (!email) next.email = 'Email is required';
    else if (!EMAIL_RE.test(email)) next.email = 'Invalid email format';

    if (!password) next.password = 'Password is required';
    else if (password.length < 8) next.password = 'Password must be at least 8 characters';

    if (password !== confirmPassword)
      next.confirmPassword = 'Passwords do not match';

    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setApiError('');

    if (!validate()) return;

    setLoading(true);
    try {
      await register(email, username.trim(), password);
      navigate('/workspaces', { replace: true });
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'Registration failed. Please try again.';
      setApiError(msg);
    } finally {
      setLoading(false);
    }
  }

  const metRequirements = PASSWORD_REQUIREMENTS.map((r) => ({
    ...r,
    met: r.test(password),
  }));

  return (
    <motion.div
      className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-12"
      variants={{
        initial: { opacity: 0.99, y: 6 },
        animate: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] as const } },
        exit: { opacity: 0, y: -12, transition: { duration: 0.2 } },
      }}
      initial="initial"
      animate="animate"
      exit="exit"
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
            <span className="gradient-text">Create account</span>
          </motion.h1>

          <motion.p
            className="mt-2 text-sm text-text-muted"
            initial={{ opacity: 0.99 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.35, duration: 0.5 }}
          >
            Get started with TruthLens AI
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
                    transition: { staggerChildren: 0.07, delayChildren: 0.2 },
                  },
                }}
                initial="initial"
                animate="animate"
              >
                {/* Username */}
                <motion.div
                  variants={{
                    initial: { opacity: 0.99, y: 8 },
                    animate: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] as const } },
                  }}
                >
                  <Input
                    label="Username"
                    type="text"
                    placeholder="yourname"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    error={errors.username}
                    icon={<User size={16} />}
                    autoComplete="username"
                  />
                </motion.div>

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
                  <Input
                    label="Password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Create a strong password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    error={errors.password}
                    icon={<Lock size={16} />}
                    autoComplete="new-password"
                  />

                  {/* Password requirements hint */}
                  <AnimatePresence>
                    {password.length > 0 && (
                      <motion.ul
                        initial={{ opacity: 0.99, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] as const }}
                        className="space-y-1.5 overflow-hidden pt-1"
                      >
                        {metRequirements.map((req) => (
                          <motion.li
                            key={req.label}
                            initial={{ opacity: 0.99, x: -8 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ duration: 0.25 }}
                            className="flex items-center gap-2 text-xs"
                          >
                            <motion.span
                              animate={{
                                scale: req.met ? [1, 1.3, 1] : 1,
                                backgroundColor: req.met
                                  ? 'rgba(52, 211, 153, 0.2)'
                                  : 'transparent',
                              }}
                              transition={{ duration: 0.3 }}
                              className={
                                'flex h-4 w-4 items-center justify-center rounded-full ' +
                                (req.met
                                  ? 'bg-green/20 text-green'
                                  : 'text-text-dim')
                              }
                            >
                              {req.met ? (
                                <motion.span
                                  initial={{ scale: 0 }}
                                  animate={{ scale: 1 }}
                                  transition={{
                                    type: 'spring',
                                    stiffness: 400,
                                    damping: 15,
                                  }}
                                >
                                  <Check size={10} strokeWidth={3} />
                                </motion.span>
                              ) : (
                                <span className="block h-1.5 w-1.5 rounded-full bg-current" />
                              )}
                            </motion.span>
                            <span
                              className={
                                req.met ? 'text-green' : 'text-text-muted'
                              }
                            >
                              {req.label}
                            </span>
                          </motion.li>
                        ))}
                      </motion.ul>
                    )}
                  </AnimatePresence>
                </motion.div>

                {/* Confirm Password */}
                <motion.div
                  variants={{
                    initial: { opacity: 0.99, y: 8 },
                    animate: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] as const } },
                  }}
                >
                  <Input
                    label="Confirm password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Re-enter your password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    error={errors.confirmPassword}
                    icon={<Lock size={16} />}
                    autoComplete="new-password"
                  />
                </motion.div>
              </motion.div>

              {/* Show password toggle + Submit */}
              <motion.div
                className="space-y-4"
                initial={{ opacity: 0.99, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5, duration: 0.4 }}
              >
                <motion.button
                  type="button"
                  onClick={() => setShowPassword((p) => !p)}
                  className="flex items-center gap-2 text-xs text-text-muted hover:text-text transition-colors"
                  whileHover={{ x: 3 }}
                  whileTap={{ scale: 0.97 }}
                >
                  <motion.div
                    key={showPassword ? 'eye-off' : 'eye'}
                    initial={{ rotateY: 90, opacity: 0.99 }}
                    animate={{ rotateY: 0, opacity: 1 }}
                    transition={{ duration: 0.2 }}
                  >
                    {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                  </motion.div>
                  {showPassword ? 'Hide' : 'Show'} passwords
                </motion.button>

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
                  <UserPlus size={18} />
                  Create account
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
          transition={{ delay: 0.55, duration: 0.5 }}
        >
          Already have an account?{' '}
          <Link
            to="/login"
            className="relative font-medium text-primary-soft hover:text-primary transition-colors"
          >
            <motion.span
              className="inline-block"
              whileHover={{ x: 2 }}
              transition={{ type: 'spring', stiffness: 300 }}
            >
              Sign in
            </motion.span>
          </Link>
        </motion.p>

        {/* Bottom decorative gradient line */}
        <motion.div
          className="mx-auto mt-8 h-px max-w-[200px] bg-gradient-to-r from-transparent via-primary/30 to-transparent"
          initial={{ scaleX: 0.01, opacity: 0.99 }}
          animate={{ scaleX: 1, opacity: 1 }}
          transition={{ delay: 0.75, duration: 0.8, ease: [0.16, 1, 0.3, 1] as const }}
          aria-hidden="true"
        />
      </div>
    </motion.div>
  );
}

import { useState, useEffect, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Mail, Lock, User, Eye, EyeOff, UserPlus, Check, AlertCircle } from 'lucide-react';
import PremiumButton from '../components/premium/PremiumButton';
import AnimatedInput from '../components/premium/AnimatedInput';
import { Card } from '../components/ui';
import { useAuth } from '../context/auth-context';
import Logo from '../components/Logo';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_REQUIREMENTS = [
  { label: 'At least 8 characters', test: (v: string) => v.length >= 8 },
  { label: 'One uppercase letter', test: (v: string) => /[A-Z]/.test(v) },
  { label: 'One digit', test: (v: string) => /\d/.test(v) },
];

export default function RegisterPage() {
  const { register, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [apiError, setApiError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isAuthenticated) navigate('/workspaces', { replace: true });
  }, [isAuthenticated, navigate]);

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!username.trim()) next.username = 'Username is required';
    else if (username.trim().length < 3) next.username = 'Username must be at least 3 characters';
    if (!email) next.email = 'Email is required';
    else if (!EMAIL_RE.test(email)) next.email = 'Invalid email format';
    if (!password) next.password = 'Password is required';
    else if (password.length < 8) next.password = 'Password must be at least 8 characters';
    if (password !== confirmPassword) next.confirmPassword = 'Passwords do not match';
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
      const msg = err instanceof Error ? err.message : 'Registration failed. Please try again.';
      setApiError(msg);
    } finally {
      setLoading(false);
    }
  }

  const metRequirements = PASSWORD_REQUIREMENTS.map((r) => ({ ...r, met: r.test(password) }));

  return (
    <motion.div
      className="relative flex min-h-screen items-center justify-center px-4 py-12"
      initial={{ opacity: 0.99, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12, transition: { duration: 0.2 } }}
    >
      {/* No decorative background layer: the ruled ground from <body> is the
          whole surface. See LoginPage — an auth screen earns trust by
          restraint, not by atmosphere. */}
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
            transition={{ type: 'spring', stiffness: 200, damping: 15, delay: 0.1 }}
          >
            <div className="flex h-16 w-16 items-center justify-center rounded-panel bg-primary shadow-e1">
              <Logo size={36} animated={false} />
            </div>
          </motion.div>

          <motion.h1 className="text-3xl font-semibold tracking-tight text-text" initial={{ opacity: 0.99, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25, duration: 0.5 }}>
            Create account
          </motion.h1>

          <motion.p className="mt-2 text-sm text-text-muted" initial={{ opacity: 0.99 }} animate={{ opacity: 1 }} transition={{ delay: 0.35, duration: 0.5 }}>
            Get started with TruthLens AI
          </motion.p>
        </motion.div>

        {/* Card */}
        <motion.div
          initial={{ opacity: 0.99, y: 30, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ delay: 0.15, duration: 0.6, ease: [0.16, 1, 0.3, 1] as const }}
        >
          <Card className="p-6 shadow-e3 lg:p-8">
            <form onSubmit={handleSubmit} noValidate className="space-y-5">
              {/* API Error */}
              <AnimatePresence>
                {apiError && (
                  <motion.div
                    initial={{ opacity: 0.99, y: -12, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -12, scale: 0.95 }}
                    transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] as const }}
                    className="rounded-control border border-red/28 bg-red/10 px-4 py-3 text-sm text-red"
                    role="alert"
                  >
                    <span className="flex items-start gap-2">
                      <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                      {apiError}
                    </span>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Form fields with stagger */}
              <motion.div
                className="space-y-5"
                variants={{ animate: { transition: { staggerChildren: 0.07, delayChildren: 0.2 } } }}
                initial="initial"
                animate="animate"
              >
                {/* Username */}
                <motion.div variants={{ initial: { opacity: 0.99, y: 8 }, animate: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] as const } } }}>
                  <AnimatedInput
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
                <motion.div variants={{ initial: { opacity: 0.99, y: 8 }, animate: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] as const } } }}>
                  <AnimatedInput
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
                <motion.div className="space-y-1.5" variants={{ initial: { opacity: 0.99, y: 8 }, animate: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] as const } } }}>
                  <AnimatedInput
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
                              animate={{ scale: req.met ? [1, 1.3, 1] : 1 }}
                              transition={{ duration: 0.3 }}
                              className={'flex h-4 w-4 items-center justify-center rounded-full ' + (req.met ? 'bg-green/15 text-green' : 'text-text-dim')}
                            >
                              {req.met ? (
                                <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 400, damping: 15 }}>
                                  <Check size={10} strokeWidth={3} />
                                </motion.span>
                              ) : (
                                <span className="block h-1.5 w-1.5 rounded-full bg-current" />
                              )}
                            </motion.span>
                            <span className={req.met ? 'text-green' : 'text-text-muted'}>{req.label}</span>
                          </motion.li>
                        ))}
                      </motion.ul>
                    )}
                  </AnimatePresence>
                </motion.div>

                {/* Confirm Password */}
                <motion.div variants={{ initial: { opacity: 0.99, y: 8 }, animate: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] as const } } }}>
                  <AnimatedInput
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

              {/* Submit */}
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
                  <motion.div key={showPassword ? 'eye-off' : 'eye'} initial={{ rotateY: 90, opacity: 0.99 }} animate={{ rotateY: 0, opacity: 1 }} transition={{ duration: 0.2 }}>
                    {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                  </motion.div>
                  {showPassword ? 'Hide' : 'Show'} passwords
                </motion.button>

                <PremiumButton type="submit" loading={loading} className="w-full" size="lg" icon={<UserPlus size={18} />}>
                  Create account
                </PremiumButton>
              </motion.div>
            </form>
          </Card>
        </motion.div>

        {/* Footer */}
        <motion.p className="mt-6 text-center text-sm text-text-muted" initial={{ opacity: 0.99 }} animate={{ opacity: 1 }} transition={{ delay: 0.55, duration: 0.5 }}>
          Already have an account?{' '}
          <Link to="/login" className="relative font-medium text-primary-soft hover:text-primary transition-colors">
            <motion.span className="inline-block" whileHover={{ x: 2 }} transition={{ type: 'spring', stiffness: 300 }}>
              Sign in
            </motion.span>
          </Link>
        </motion.p>
      </div>
    </motion.div>
  );
}

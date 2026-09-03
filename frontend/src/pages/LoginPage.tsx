import { useState, useEffect, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Mail, Lock, Eye, EyeOff, LogIn, AlertCircle } from 'lucide-react';
import PremiumButton from '../components/premium/PremiumButton';
import AnimatedInput from '../components/premium/AnimatedInput';
import { Card } from '../components/ui';
import { useAuth } from '../context/auth-context';
import Logo from '../components/Logo';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function LoginPage() {
  const { login, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [apiError, setApiError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isAuthenticated) navigate('/workspaces', { replace: true });
  }, [isAuthenticated, navigate]);

  function validate(): boolean {
    const trimmedEmail = email.trim();
    const trimmedPassword = password.trim();
    const next: { email?: string; password?: string } = {};
    if (!trimmedEmail) next.email = 'Email is required';
    else if (!EMAIL_RE.test(trimmedEmail)) next.email = 'Invalid email format';
    if (!trimmedPassword) next.password = 'Password is required';
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setApiError('');
    if (!validate()) return;
    setLoading(true);
    try {
      await login(email.trim(), password.trim());
      navigate('/workspaces', { replace: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Login failed. Please try again.';
      setApiError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    // The auth surface is deliberately bare: the ruled ground from <body> is
    // the whole background. The pan-gradient wash, the ambient blobs and the
    // drifting Sparkles/Logo particles were Midnight-era chrome — on a
    // sign-in screen anything decorative reads as an attempt to look
    // legitimate, which is the opposite of what this page needs to convey.
    <motion.div className="relative flex min-h-screen items-center justify-center px-4 py-12">
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

          <motion.h1
            className="text-3xl font-semibold tracking-tight text-text"
            initial={{ opacity: 0.99, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25, duration: 0.5 }}
          >
            Welcome back
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
                variants={{ animate: { transition: { staggerChildren: 0.08, delayChildren: 0.2 } } }}
                initial="initial"
                animate="animate"
              >
                {/* Email */}
                <motion.div
                  variants={{ initial: { opacity: 0.99, y: 8 }, animate: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] as const } } }}
                >
                  <AnimatedInput
                    label="Email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      if (errors.email) setErrors(prev => ({ ...prev, email: undefined }));
                    }}
                    error={errors.email}
                    icon={<Mail size={16} />}
                    autoComplete="email"
                  />
                </motion.div>

                {/* Password */}
                <motion.div
                  className="space-y-1.5"
                  variants={{ initial: { opacity: 0.99, y: 8 }, animate: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] as const } } }}
                >
                  <div className="flex items-center justify-between">
                    <label htmlFor="password" className="block text-sm font-medium text-text-muted">Password</label>
                    <Link to="/forgot-password" className="text-xs text-primary-soft transition-colors hover:text-primary">Forgot password?</Link>
                  </div>
                  <div className="relative">
                    <AnimatedInput
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      placeholder="Enter your password"
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        if (errors.password) setErrors(prev => ({ ...prev, password: undefined }));
                      }}
                      error={errors.password}
                      icon={<Lock size={16} />}
                      autoComplete="current-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((p) => !p)}
                      // Anchored to the field row, not the wrapper: the wrapper
                      // grows by the error line, which used to drag a
                      // vertically-centred toggle off the input.
                      className="absolute right-2.5 top-[5px] z-10 flex h-8 w-8 items-center justify-center rounded-chip text-text-dim transition-colors hover:bg-card-2 hover:text-text"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </motion.div>
              </motion.div>

              {/* Submit */}
              <motion.div
                initial={{ opacity: 0.99, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.45, duration: 0.4 }}
              >
                <PremiumButton
                  type="submit"
                  loading={loading}
                  className="w-full"
                  size="lg"
                  icon={<LogIn size={18} />}
                >
                  Sign in
                </PremiumButton>
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
          <Link to="/register" className="relative font-medium text-primary-soft hover:text-primary transition-colors">
            <motion.span className="inline-block" whileHover={{ x: 2 }} transition={{ type: 'spring', stiffness: 300 }}>
              Create one
            </motion.span>
          </Link>
        </motion.p>
      </div>
    </motion.div>
  );
}

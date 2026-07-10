import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Lock, ArrowLeft, CheckCircle, RefreshCw } from 'lucide-react';
import PremiumButton from '../components/premium/PremiumButton';
import AnimatedInput from '../components/premium/AnimatedInput';
import { Card } from '../components/ui';
import { authApi } from '../api/client';

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [apiError, setApiError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!password) next.password = 'Password is required';
    else if (password.length < 8) next.password = 'Password must be at least 8 characters';
    else if (!/[A-Z]/.test(password)) next.password = 'Must contain an uppercase letter';
    else if (!/\d/.test(password)) next.password = 'Must contain a digit';
    if (password !== confirmPassword) next.confirmPassword = 'Passwords do not match';
    if (!token) next.token = 'Reset token is missing';
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setApiError('');
    if (!validate()) return;
    setLoading(true);
    try {
      await authApi.resetPassword({ token, password });
      setSuccess(true);
      setTimeout(() => navigate('/login', { replace: true }), 2000);
    } catch (err) {
      setApiError(err instanceof Error ? err.message : 'Failed to reset password. Token may be expired.');
    } finally {
      setLoading(false);
    }
  }

  if (!token && !success) {
    return (
      <motion.div
        className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-12"
        initial={{ opacity: 0.99, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      >
        <motion.div
          className="absolute inset-0 opacity-30"
          style={{
            background: 'linear-gradient(135deg, rgba(124,92,255,0.15), rgba(45,212,191,0.08), rgba(56,189,248,0.12), rgba(124,92,255,0.15))',
            backgroundSize: '400% 400%',
          }}
          animate={{ backgroundPosition: ['0% 50%', '100% 50%', '0% 50%'] }}
          transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
          aria-hidden="true"
        />
        <div className="ambient-blob ambient-blob-1" aria-hidden="true" />
        <div className="ambient-blob ambient-blob-2" aria-hidden="true" />
        <div className="ambient-blob ambient-blob-3" aria-hidden="true" />
        <div className="relative z-10 w-full max-w-md text-center">
          <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-2xl glass border border-red/20">
            <RefreshCw size={36} className="text-red" />
          </div>
          <h2 className="text-2xl font-bold text-text">Invalid or missing token</h2>
          <p className="mt-2 text-sm text-text-muted">This password reset link is invalid or has expired.</p>
          <Link to="/forgot-password" className="mt-6 inline-block">
            <PremiumButton variant="secondary">Request new reset link</PremiumButton>
          </Link>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-12"
      initial={{ opacity: 0.99, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* Slow pan animated gradient background */}
      <motion.div
        className="absolute inset-0 opacity-30"
        style={{
          background: 'linear-gradient(135deg, rgba(124,92,255,0.15), rgba(45,212,191,0.08), rgba(56,189,248,0.12), rgba(124,92,255,0.15))',
          backgroundSize: '400% 400%',
        }}
        animate={{ backgroundPosition: ['0% 50%', '100% 50%', '0% 50%'] }}
        transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
        aria-hidden="true"
      />

      <div className="ambient-blob ambient-blob-1" aria-hidden="true" />
      <div className="ambient-blob ambient-blob-2" aria-hidden="true" />
      <div className="ambient-blob ambient-blob-3" aria-hidden="true" />

      <div className="relative z-10 w-full max-w-md">
        <motion.div
          className="mb-8 text-center"
          initial={{ opacity: 0.99, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        >
          <motion.div
            className="mx-auto mb-5 flex h-16 w-16 items-center justify-center"
            initial={{ scale: 0, rotate: -180 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 200, damping: 15, delay: 0.1 }}
          >
            <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary via-primary-soft to-accent shadow-2xl shadow-primary/30">
              <Lock size={28} className="text-white" />
            </div>
          </motion.div>

          <motion.h1 className="text-3xl font-bold" initial={{ opacity: 0.99, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25, duration: 0.5 }}>
            <span className="gradient-text">Set new password</span>
          </motion.h1>

          <motion.p className="mt-2 text-sm text-text-muted" initial={{ opacity: 0.99 }} animate={{ opacity: 1 }} transition={{ delay: 0.35, duration: 0.5 }}>
            {success ? 'Password updated! Redirecting to login...' : 'Enter your new password below'}
          </motion.p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0.99, y: 30, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ delay: 0.15, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        >
          <Card className="relative overflow-hidden p-6 lg:p-8">
            <div className="pointer-events-none absolute -inset-x-20 -top-40 h-80 w-[calc(100%+160px)] opacity-30" style={{ background: 'radial-gradient(ellipse 80% 60% at 50% -20%, rgba(124,92,255,0.15), transparent)' }} aria-hidden="true" />

            {success ? (
              <motion.div
                initial={{ opacity: 0.99, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                className="relative space-y-5 text-center"
              >
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 200, damping: 12, delay: 0.1 }}
                  className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-green/15 border border-green/25"
                >
                  <CheckCircle size={40} className="text-green" />
                </motion.div>
                <h3 className="text-lg font-semibold text-text">Password updated</h3>
                <p className="text-sm text-text-muted">You will be redirected to login shortly.</p>
              </motion.div>
            ) : (
              <form onSubmit={handleSubmit} noValidate className="relative space-y-5">
                <AnimatePresence>
                  {apiError && (
                    <motion.div
                      initial={{ opacity: 0.99, y: -12, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -12, scale: 0.95 }}
                      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                      className="rounded-xl border border-red/30 bg-red/10 px-4 py-3 text-sm text-red backdrop-blur-sm"
                      role="alert"
                    >
                      {apiError}
                    </motion.div>
                  )}
                </AnimatePresence>

                <motion.div
                  className="space-y-5"
                  variants={{ animate: { transition: { staggerChildren: 0.08, delayChildren: 0.2 } } }}
                  initial="initial"
                  animate="animate"
                >
                  <motion.div
                    className="space-y-1.5"
                    variants={{ initial: { opacity: 0.99, y: 8 }, animate: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] as const } } }}
                  >
                    <div className="flex items-center justify-between">
                      <label htmlFor="new-password" className="block text-sm font-medium text-text-muted">New password</label>
                      <button type="button" onClick={() => setShowPassword((p) => !p)} className="text-xs text-primary-soft/70 hover:text-primary-soft transition-colors" tabIndex={-1}>
                        {showPassword ? 'Hide' : 'Show'}
                      </button>
                    </div>
                    <div className="relative">
                      <AnimatedInput
                        id="new-password"
                        type={showPassword ? 'text' : 'password'}
                        placeholder="Enter new password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        error={errors.password}
                        icon={<Lock size={16} />}
                        autoComplete="new-password"
                      />
                    </div>
                  </motion.div>

                  <motion.div variants={{ initial: { opacity: 0.99, y: 8 }, animate: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] as const } } }}>
                    <AnimatedInput
                      label="Confirm new password"
                      type={showPassword ? 'text' : 'password'}
                      placeholder="Re-enter new password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      error={errors.confirmPassword}
                      icon={<Lock size={16} />}
                      autoComplete="new-password"
                    />
                  </motion.div>
                </motion.div>

                <motion.div
                  initial={{ opacity: 0.99, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.45, duration: 0.4 }}
                >
                  <PremiumButton type="submit" loading={loading} className="w-full" size="lg">
                    <RefreshCw size={18} />
                    Reset password
                  </PremiumButton>
                </motion.div>
              </form>
            )}
          </Card>
        </motion.div>

        <motion.p className="mt-6 text-center text-sm text-text-muted" initial={{ opacity: 0.99 }} animate={{ opacity: 1 }} transition={{ delay: 0.5, duration: 0.5 }}>
          <Link to="/login" className="relative font-medium text-primary-soft hover:text-primary transition-colors inline-flex items-center gap-1.5">
            <ArrowLeft size={14} />
            Back to login
          </Link>
        </motion.p>

        <motion.div
          className="mx-auto mt-8 h-px max-w-[200px] bg-gradient-to-r from-transparent via-primary/30 to-transparent"
          initial={{ scaleX: 0.01, opacity: 0.99 }}
          animate={{ scaleX: 1, opacity: 1 }}
          transition={{ delay: 0.7, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          aria-hidden="true"
        />
      </div>
    </motion.div>
  );
}

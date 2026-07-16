import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Mail, ArrowLeft, CheckCircle, Shield } from 'lucide-react';
import PremiumButton from '../components/premium/PremiumButton';
import AnimatedInput from '../components/premium/AnimatedInput';
import { Card } from '../components/ui';
import { authApi } from '../api/client';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  function validate(): boolean {
    if (!email) { setError('Email is required'); return false; }
    if (!EMAIL_RE.test(email)) { setError('Invalid email format'); return false; }
    return true;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!validate()) return;
    setLoading(true);
    try {
      await authApi.forgotPassword({ email });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send reset email. Please try again.');
    } finally {
      setLoading(false);
    }
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
          background: 'linear-gradient(135deg, rgba(232,193,90,0.15), rgba(91,185,138,0.08), rgba(232,193,90,0.12), rgba(232,193,90,0.15))',
          backgroundSize: '400% 400%',
        }}
        animate={{ backgroundPosition: ['0% 50%', '100% 50%', '0% 50%'] }}
        transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
        aria-hidden="true"
      />

      {/* Ambient blobs */}
      <div className="ambient-blob ambient-blob-1" aria-hidden="true" />
      <div className="ambient-blob ambient-blob-2" aria-hidden="true" />
      <div className="ambient-blob ambient-blob-3" aria-hidden="true" />

      <div className="relative z-10 w-full max-w-md">
        {/* Brand */}
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
              <Shield size={28} className="text-white" />
            </div>
          </motion.div>

          <motion.h1 className="text-3xl font-bold" initial={{ opacity: 0.99, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25, duration: 0.5 }}>
            <span className="gradient-text">Reset password</span>
          </motion.h1>

          <motion.p className="mt-2 text-sm text-text-muted" initial={{ opacity: 0.99 }} animate={{ opacity: 1 }} transition={{ delay: 0.35, duration: 0.5 }}>
            {sent ? 'Check your email for the reset link' : "Enter your email and we'll send you a reset link"}
          </motion.p>
        </motion.div>

        {/* Card */}
        <motion.div
          initial={{ opacity: 0.99, y: 30, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ delay: 0.15, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        >
          <Card className="relative overflow-hidden p-6 lg:p-8">
            <div className="pointer-events-none absolute -inset-x-20 -top-40 h-80 w-[calc(100%+160px)] opacity-30" style={{ background: 'radial-gradient(ellipse 80% 60% at 50% -20%, rgba(232,193,90,0.15), transparent)' }} aria-hidden="true" />

            {sent ? (
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
                <div>
                  <h3 className="text-lg font-semibold text-text">Email sent</h3>
                  <p className="mt-1 text-sm text-text-muted">
                    If an account exists for <strong className="text-text">{email}</strong>, you will receive a password reset link shortly.
                  </p>
                </div>
                <Link to="/login">
                  <PremiumButton className="w-full" variant="secondary">
                    <ArrowLeft size={16} />
                    Back to login
                  </PremiumButton>
                </Link>
              </motion.div>
            ) : (
              <form onSubmit={handleSubmit} noValidate className="relative space-y-5">
                <AnimatePresence>
                  {error && (
                    <motion.div
                      initial={{ opacity: 0.99, y: -12, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -12, scale: 0.95 }}
                      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                      className="rounded-xl border border-red/30 bg-red/10 px-4 py-3 text-sm text-red backdrop-blur-sm"
                      role="alert"
                    >
                      {error}
                    </motion.div>
                  )}
                </AnimatePresence>

                <motion.div
                  variants={{ animate: { transition: { staggerChildren: 0.08, delayChildren: 0.2 } } }}
                  initial="initial"
                  animate="animate"
                >
                  <motion.div
                    variants={{ initial: { opacity: 0.99, y: 8 }, animate: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] as const } } }}
                  >
                    <AnimatedInput
                      label="Email"
                      type="email"
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => { setEmail(e.target.value); setError(''); }}
                      error={error}
                      icon={<Mail size={16} />}
                      autoComplete="email"
                    />
                  </motion.div>
                </motion.div>

                <motion.div
                  initial={{ opacity: 0.99, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.45, duration: 0.4 }}
                >
                  <PremiumButton type="submit" loading={loading} className="w-full" size="lg">
                    <Mail size={18} />
                    Send reset link
                  </PremiumButton>
                </motion.div>
              </form>
            )}
          </Card>
        </motion.div>

        {/* Footer */}
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

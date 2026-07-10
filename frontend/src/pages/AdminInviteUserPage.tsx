import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Mail, UserPlus, CheckCircle, ArrowLeft } from 'lucide-react';
import { Button, Card, Input, Select, useToast, pageTransition } from '../components/ui';
import { PageShell, PageHeader, StateBlock } from '../components/PageWrappers';
import { adminApi } from '../api/client';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function AdminInviteUserPage() {
  const navigate = useNavigate();
  const { addToast } = useToast();

  const [email, setEmail] = useState('');
  const [role, setRole] = useState('user');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  function validate(): boolean {
    if (!email) {
      setError('Email is required');
      return false;
    }
    if (!EMAIL_RE.test(email)) {
      setError('Invalid email format');
      return false;
    }
    return true;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!validate()) return;

    setLoading(true);
    try {
      await adminApi.inviteUser({ email, username: email.split('@')[0], role });
      setSent(true);
      addToast(`Invitation sent to ${email}`, 'success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send invitation. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <motion.div variants={pageTransition} initial="initial" animate="animate">
      <PageShell className="max-w-lg">
        <button
          type="button"
          onClick={() => navigate('/admin/users')}
          className="inline-flex items-center gap-1.5 text-xs text-text-muted hover:text-text transition-colors"
        >
          <ArrowLeft size={14} />
          Back to Users
        </button>

        <Card className="p-5 lg:p-6">
          <PageHeader
            title="Invite User"
            description="Send an invitation to join the platform."
            className="mb-5"
          />

          {sent ? (
            <motion.div
              initial={{ opacity: 0.99, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="space-y-5 text-center"
            >
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 200, damping: 12 }}
                className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-green/15 border border-green/25"
              >
                <CheckCircle size={40} className="text-green" />
              </motion.div>
              <div>
                <h3 className="text-lg font-semibold text-text">Invitation sent</h3>
                <p className="text-sm text-text-muted mt-1">
                  An invitation email has been sent to <strong className="text-text">{email}</strong>.
                </p>
              </div>
              <div className="flex gap-3 justify-center">
                <Button
                  onClick={() => {
                    setSent(false);
                    setEmail('');
                  }}
                  size="sm"
                >
                  <UserPlus size={14} />
                  Invite Another
                </Button>
                <Button variant="secondary" size="sm" onClick={() => navigate('/admin/users')}>
                  View Users
                </Button>
              </div>
            </motion.div>
          ) : (
            <form onSubmit={handleSubmit} noValidate className="space-y-4">
              <AnimatePresence>
                {error && (
                  <motion.div
                    initial={{ opacity: 0.99, y: -12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -12 }}
                  >
                    <StateBlock tone="danger" role="alert">
                      {error}
                    </StateBlock>
                  </motion.div>
                )}
              </AnimatePresence>

              <Input
                label="Email address"
                type="email"
                placeholder="newuser@example.com"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setError('');
                }}
                icon={<Mail size={16} />}
                required
              />

              <Select
                label="Role"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                options={[
                  { value: 'user', label: 'User' },
                  { value: 'admin', label: 'Admin' },
                ]}
              />

              <Button type="submit" loading={loading} className="w-full">
                <UserPlus size={16} />
                Send Invitation
              </Button>
            </form>
          )}
        </Card>
      </PageShell>
    </motion.div>
  );
}

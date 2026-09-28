import { useState, type FormEvent, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  User, Mail, Lock, Eye, EyeOff, AlertTriangle, Key, Shield, Sparkles,
} from 'lucide-react';
import { Button, Modal } from '../components/ui';
import { pageTransition, staggerContainer, staggerItem } from '../components/motion';
import { useToast } from '../components/toast-context';
import { PageHeader, PageShell } from '../components/PageWrappers';
import { useAuth } from '../context/auth-context';
import { authApi } from '../api/client';
import PremiumButton from '../components/premium/PremiumButton';
import AnimatedInput, { InputActionButton } from '../components/premium/AnimatedInput';

// The aurora washes, scanning line, pulsing icon halos and neon borders that
// used to decorate these cards are gone: the Claim Ledger system is flat, and
// those infinite framer loops ignored prefers-reduced-motion.

// ─── Section Header ────────────────────────────────────────────────────────
function SectionHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2.5 mb-5">
      {icon}
      <span className="text-base font-semibold text-text">{title}</span>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────
export default function SettingsPage() {
  const { user } = useAuth();
  const { addToast } = useToast();
  const navigate = useNavigate();

  // Profile
  const [name, setName] = useState(user?.username || '');
  const [email, setEmail] = useState(user?.email || '');
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileSuccess, setProfileSuccess] = useState(false);

  // Password
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [passwordErrors, setPasswordErrors] = useState<Record<string, string>>({});
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordSuccess, setPasswordSuccess] = useState(false);

  // Delete
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);

  const profileCardRef = useRef<HTMLDivElement>(null);
  const passwordCardRef = useRef<HTMLDivElement>(null);

  // ── Handlers ────────────────────────────────────────────────────────────

  async function handleProfileSave(e: FormEvent) {
    e.preventDefault();
    if (profileLoading || profileSuccess) return;
    setProfileLoading(true);
    setProfileSuccess(false);
    try {
      await authApi.updateMe({ username: name, email });
      setProfileSuccess(true);
      addToast('Profile updated successfully', 'success');
      setTimeout(() => setProfileSuccess(false), 2000);
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to update profile', 'error');
    } finally {
      setProfileLoading(false);
    }
  }

  async function handlePasswordChange(e: FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!currentPassword) errs.current = 'Current password is required';
    if (!newPassword || newPassword.length < 8) errs.new = 'Must be at least 8 characters';
    else if (!/[A-Z]/.test(newPassword)) errs.new = 'Must contain an uppercase letter';
    else if (!/\d/.test(newPassword)) errs.new = 'Must contain a digit';
    if (newPassword !== confirmPassword) errs.confirm = 'Passwords do not match';
    setPasswordErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setPasswordLoading(true);
    setPasswordSuccess(false);
    try {
      await authApi.changePassword({ current_password: currentPassword, new_password: newPassword });
      setPasswordSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      addToast('Password updated successfully', 'success');
      setTimeout(() => setPasswordSuccess(false), 2000);
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to update password', 'error');
    } finally {
      setPasswordLoading(false);
    }
  }

  async function handleDeleteAccount() {
    setDeleteLoading(true);
    try {
      await authApi.deleteMe();
      setDeleteModalOpen(false);
      setDeleteConfirm('');
      addToast('Account deleted', 'success');
      navigate('/login', { replace: true });
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to delete account', 'error');
    } finally {
      setDeleteLoading(false);
    }
  }

  return (
    <>
      <div className="-mx-4 lg:-mx-6 px-4 lg:px-8 xl:px-12">
        <motion.div
          className="relative z-10 mx-auto max-w-2xl space-y-6 py-6"
          variants={pageTransition}
          initial="initial"
          animate="animate"
        >
        <PageShell className="space-y-6">
        {/* Page header */}
        <motion.div variants={staggerItem}>
          <PageHeader
            title="Settings"
            description="Manage your account, security, and preferences."
          />
        </motion.div>

        <motion.div
          className="space-y-5"
          variants={staggerContainer}
          initial="initial"
          animate="animate"
        >
          {/* ═══ PROFILE CARD ═════════════════════════════════════════════════ */}
          <motion.div variants={staggerItem} ref={profileCardRef}>
            <div className="relative overflow-hidden rounded-xl glass border border-border p-5 lg:p-6">
              <div className="relative z-10">
                <SectionHeader icon={<User size={16} className="text-primary-soft" />} title="Profile" />

                <form onSubmit={handleProfileSave} className="space-y-4">
                  <AnimatedInput
                    label="Name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    icon={<User size={15} />}
                  />
                  <AnimatedInput
                    label="Email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    icon={<Mail size={15} />}
                  />
                  <div className="pt-2">
                    <PremiumButton
                      type="submit"
                      loading={profileLoading}
                      success={profileSuccess}
                      size="sm"
                      icon={<Sparkles size={14} />}
                    >
                      Save Changes
                    </PremiumButton>
                  </div>
                </form>
              </div>
            </div>
          </motion.div>

          {/* ═══ PASSWORD CARD ════════════════════════════════════════════════ */}
          <motion.div variants={staggerItem} ref={passwordCardRef}>
            <div className="relative overflow-hidden rounded-xl glass border border-border p-5 lg:p-6">
              <div className="relative z-10">
                <SectionHeader icon={<Lock size={16} className="text-green" />} title="Password" />

                <form onSubmit={handlePasswordChange} className="space-y-4">
                  <AnimatedInput
                    label="Current password"
                    type={showPasswords ? 'text' : 'password'}
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    error={passwordErrors.current}
                    icon={<Key size={15} />}
                    actionButton={
                      <InputActionButton
                        onClick={() => setShowPasswords((p) => !p)}
                        active={showPasswords}
                        aria-label={showPasswords ? 'Hide passwords' : 'Show passwords'}
                      >
                        {showPasswords ? <EyeOff size={13} /> : <Eye size={13} />}
                      </InputActionButton>
                    }
                  />
                  <AnimatedInput
                    label="New password"
                    type={showPasswords ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    error={passwordErrors.new}
                    icon={<Lock size={15} />}
                  />
                  <AnimatedInput
                    label="Confirm new password"
                    type={showPasswords ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    error={passwordErrors.confirm}
                    icon={<Shield size={15} />}
                  />
                  <div className="pt-2">
                    <PremiumButton
                      type="submit"
                      loading={passwordLoading}
                      success={passwordSuccess}
                      size="sm"
                      icon={<Sparkles size={14} />}
                    >
                      Update Password
                    </PremiumButton>
                  </div>
                </form>
              </div>
            </div>
          </motion.div>

          {/* ═══ DANGER ZONE ══════════════════════════════════════════════════ */}
          <motion.div variants={staggerItem}>
            <div className="relative overflow-hidden rounded-xl border border-red/25 bg-card p-5 lg:p-6">
              <div className="relative z-10">
                <div className="flex items-center gap-2.5 mb-4">
                  <AlertTriangle size={16} className="text-red" aria-hidden="true" />
                  <span className="text-base font-semibold text-red">Danger Zone</span>
                </div>
                <p className="text-sm text-text-muted mb-4">
                  Once you delete your account, there is no going back. Please be certain.
                </p>
                <PremiumButton
                  variant="danger"
                  size="sm"
                  onClick={() => setDeleteModalOpen(true)}
                  icon={<AlertTriangle size={14} />}
                >
                  Delete Account
                </PremiumButton>
              </div>
            </div>
          </motion.div>
        </motion.div>

        {/* Delete Confirmation Modal */}
        <Modal
          open={deleteModalOpen}
          onClose={() => { setDeleteModalOpen(false); setDeleteConfirm(''); }}
          title="Delete Account"
        >
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-xl bg-red/10 border border-red/20 p-4">
              <AlertTriangle size={20} className="text-red shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-red">This action is irreversible</p>
                <p className="text-xs text-text-muted mt-1">All your data, chats, and workspaces will be permanently deleted.</p>
              </div>
            </div>
            <AnimatedInput
              label="Type DELETE to confirm"
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder="DELETE"
            />
            <div className="flex gap-3">
              <PremiumButton
                variant="danger"
                size="sm"
                disabled={deleteConfirm !== 'DELETE'}
                loading={deleteLoading}
                onClick={handleDeleteAccount}
                icon={<AlertTriangle size={14} />}
              >
                Delete my account
              </PremiumButton>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => { setDeleteModalOpen(false); setDeleteConfirm(''); }}
              >
                Cancel
              </Button>
            </div>
          </div>
        </Modal>
        </PageShell>
        </motion.div>
      </div>
    </>
  );
}

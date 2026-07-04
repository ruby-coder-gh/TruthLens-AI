import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Shield } from 'lucide-react';
import { Button } from '../components/ui';

export default function PrivacyPage() {
  return (
    <div className="relative min-h-screen bg-bg px-4 py-16">
      <div className="ambient-blob ambient-blob-1" aria-hidden="true" />
      <div className="ambient-blob ambient-blob-2" aria-hidden="true" />

      <motion.div
        className="relative z-10 mx-auto max-w-3xl"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      >
        <Link
          to="/"
          className="mb-8 inline-flex items-center gap-2 text-sm text-text-muted hover:text-text transition-colors"
        >
          <ArrowLeft size={16} />
          Back to home
        </Link>

        <div className="mb-8 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary/20 to-accent/20">
            <Shield size={20} className="text-primary-soft" />
          </div>
          <h1 className="text-3xl font-bold text-text">Privacy Policy</h1>
        </div>

        <div className="space-y-6 text-sm text-text-muted leading-relaxed">
          <p>
            TruthLens AI ("we," "our," or "us") is committed to protecting your privacy.
            This Privacy Policy explains how we collect, use, disclose, and safeguard your
            information when you use our platform.
          </p>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-text">Information We Collect</h2>
            <p>
              We collect information you provide directly to us, including account details
              (email, name), documents you upload, and content you generate through our
              platform. We also collect usage data such as interaction logs and analytics
              to improve our service.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-text">How We Use Your Information</h2>
            <p>
              Your information is used to provide, maintain, and improve our services;
              process your requests; send technical notices and support messages; and
              detect, investigate, and prevent fraudulent transactions and abuse.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-text">Data Security</h2>
            <p>
              We implement industry-standard security measures including encryption at rest
              and in transit, access controls, and regular security audits. Your documents
              and analysis results are stored securely and never shared with third parties
              without your explicit consent.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-text">Contact</h2>
            <p>
              If you have questions about this Privacy Policy, please contact us at{' '}
              <a href="mailto:privacy@truthlens.ai" className="text-primary-soft hover:text-primary transition-colors">
                privacy@truthlens.ai
              </a>.
            </p>
          </section>
        </div>
      </motion.div>
    </div>
  );
}

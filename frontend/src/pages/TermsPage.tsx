import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Scale } from 'lucide-react';

export default function TermsPage() {
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
            <Scale size={20} className="text-primary-soft" />
          </div>
          <h1 className="text-3xl font-bold text-text">Terms of Service</h1>
        </div>

        <div className="space-y-6 text-sm text-text-muted leading-relaxed">
          <p>
            By accessing or using TruthLens AI ("the Service"), you agree to be bound
            by these Terms of Service. If you do not agree, do not use the Service.
          </p>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-text">Use of Service</h2>
            <p>
              You are responsible for maintaining the confidentiality of your account
              credentials and for all activities under your account. You agree not to
              use the Service for any unlawful purpose or in violation of any applicable
              laws or regulations.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-text">Intellectual Property</h2>
            <p>
              You retain ownership of any content you upload to the Service. TruthLens AI
              does not claim ownership over your documents or generated content. We claim
              no intellectual property rights over the material you provide.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-text">Limitation of Liability</h2>
            <p>
              The Service is provided "as is" without warranties of any kind. TruthLens AI
              shall not be liable for any direct, indirect, incidental, or consequential
              damages arising from your use of the Service.
            </p>
          </section>
        </div>
      </motion.div>
    </div>
  );
}

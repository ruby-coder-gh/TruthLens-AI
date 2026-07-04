import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Mail, MessageSquare, Github } from 'lucide-react';

export default function ContactPage() {
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
            <MessageSquare size={20} className="text-primary-soft" />
          </div>
          <h1 className="text-3xl font-bold text-text">Contact Us</h1>
        </div>

        <div className="space-y-6 text-sm text-text-muted leading-relaxed">
          <p>
            Have questions, feedback, or need help? We'd love to hear from you.
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-5">
              <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                <Mail size={18} className="text-primary-soft" />
              </div>
              <h3 className="mb-1 font-medium text-text">Email</h3>
              <p className="text-xs text-text-dim">
                <a href="mailto:hello@truthlens.ai" className="text-primary-soft hover:text-primary transition-colors">
                  hello@truthlens.ai
                </a>
              </p>
            </div>

            <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-5">
              <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-accent/10">
                <Github size={18} className="text-accent" />
              </div>
              <h3 className="mb-1 font-medium text-text">GitHub</h3>
              <p className="text-xs text-text-dim">
                <a
                  href="https://github.com/truthlens-ai"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary-soft hover:text-primary transition-colors"
                >
                  @truthlens-ai
                </a>
              </p>
            </div>
          </div>

          <p className="pt-4 text-xs text-text-dim">
            We aim to respond within 24 hours during business days.
          </p>
        </div>
      </motion.div>
    </div>
  );
}

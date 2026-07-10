import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft } from 'lucide-react';
import { Card } from './ui';

interface LegalPageLayoutProps {
  title: string;
  icon: ReactNode;
  children: ReactNode;
}

export default function LegalPageLayout({ title, icon, children }: LegalPageLayoutProps) {
  return (
    <div className="relative min-h-screen bg-bg px-4 py-14 sm:py-16">
      <div className="bg-grid" />
      <div className="ambient-blob ambient-blob-1" aria-hidden="true" />
      <div className="ambient-blob ambient-blob-2" aria-hidden="true" />

      <motion.div
        className="relative z-10 mx-auto w-full max-w-4xl space-y-6"
        initial={{ opacity: 0.99, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
      >
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-sm text-text-muted transition-colors hover:text-text"
        >
          <ArrowLeft size={15} />
          Back to home
        </Link>

        <Card className="p-6 sm:p-8">
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary/20 to-accent/20">
              {icon}
            </div>
            <h1 className="text-3xl font-bold text-text">{title}</h1>
          </div>

          <div className="space-y-6 text-sm leading-relaxed text-text-muted">
            {children}
          </div>
        </Card>
      </motion.div>
    </div>
  );
}

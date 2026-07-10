import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Home } from 'lucide-react';
import { Button, Card } from '../components/ui';

export default function NotFoundPage() {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-bg px-4 py-12">
      <div className="bg-grid" />
      <div className="ambient-blob ambient-blob-1" aria-hidden="true" />
      <div className="ambient-blob ambient-blob-2" aria-hidden="true" />
      <div className="ambient-blob ambient-blob-3" aria-hidden="true" />

      <motion.div
        className="relative z-10 w-full max-w-xl"
        initial={{ opacity: 0.99, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
      >
        <Card className="p-8 text-center sm:p-10">
          <motion.h1
            className="text-[5.5rem] font-bold leading-none tracking-tighter sm:text-[7rem]"
            initial={{ scale: 0.9, opacity: 0.99 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.05, duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
          >
            <span className="bg-gradient-to-r from-primary via-primary-soft to-accent bg-clip-text text-transparent">404</span>
          </motion.h1>

          <p className="mt-3 text-xl text-text-muted">Page not found</p>
          <p className="mx-auto mt-2 max-w-sm text-sm text-text-dim">
            Route does not exist or moved. Use one links below to continue.
          </p>

          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link to="/">
              <Button size="lg" className="gap-2">
                <Home size={18} />
                Go home
              </Button>
            </Link>
            <Link to="/login">
              <Button variant="secondary" size="lg">Sign in</Button>
            </Link>
          </div>
        </Card>
      </motion.div>

      <motion.div
        className="absolute bottom-12 text-center"
        initial={{ opacity: 0.99 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5, duration: 0.4 }}
      >
        <p className="text-xs text-text-dim">
          TruthLens AI
        </p>
      </motion.div>
    </div>
  );
}

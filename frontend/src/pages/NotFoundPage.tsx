import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Home } from 'lucide-react';
import { Button, Card } from '../components/ui';

export default function NotFoundPage() {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-bg px-4 py-12">
      {/* This page lays an opaque bg-bg over <body>, so it re-paints the ruled
          ground itself; without this it is a flat fill. The Midnight ambient
          blobs are gone — the ground and its two washes carry the depth. */}
      <div className="bg-grid" />

      <motion.div
        className="relative z-10 w-full max-w-xl"
        initial={{ opacity: 0.99, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
      >
        <Card className="p-8 text-center shadow-e3 sm:p-10">
          <motion.h1
            className="n text-[5.5rem] font-semibold leading-none tracking-tighter text-primary-soft sm:text-[7rem]"
            initial={{ scale: 0.9, opacity: 0.99 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.05, duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
          >
            404
          </motion.h1>

          <p className="mt-3 text-xl font-medium text-text">Page not found</p>
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
        <p className="text-xs text-text-muted">
          TruthLens AI
        </p>
      </motion.div>
    </div>
  );
}

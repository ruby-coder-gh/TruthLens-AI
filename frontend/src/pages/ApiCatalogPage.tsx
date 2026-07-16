import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import CenterContent from '../components/api-catalog/CenterContent';
import RightPanel from '../components/api-catalog/RightPanel';
import { pageTransition } from '../components/motion';
import { PageHeader, PageShell } from '../components/PageWrappers';

export default function ApiCatalogPage() {
  const [mobilePanel, setMobilePanel] = useState(false);

  const closeMobilePanel = useCallback(() => setMobilePanel(false), []);

  return (
    <motion.div
      variants={pageTransition}
      initial="initial"
      animate="animate"
      exit="exit"
      className="h-full"
    >
      <PageShell className="h-full">
        <PageHeader
          title="API Catalog"
          description="Browse and inspect platform API references and endpoint details."
        />

        {/* Mobile toggle */}
        <div className="flex items-center gap-2 xl:hidden">
          <button
            type="button"
            onClick={() => setMobilePanel(true)}
            className="glass rounded-lg px-3 py-1.5 text-xs text-text-muted"
          >
            Tools
          </button>
        </div>

        {/* Two-panel layout */}
        <div className="flex flex-1 gap-4 min-h-0 relative">
          {/* Center Content - full width */}
          <div className="flex-1 min-w-0">
            <CenterContent />
          </div>

          {/* Right Panel - desktop */}
          <div className="hidden xl:block">
            <RightPanel />
          </div>

          {/* Mobile right panel */}
          <AnimatePresence>
            {mobilePanel && (
              <motion.div
                initial={{ opacity: 0.99 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-50 xl:hidden"
              >
                <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={closeMobilePanel} />
                <motion.div
                  initial={{ x: 280 }}
                  animate={{ x: 0 }}
                  exit={{ x: 280 }}
                  className="absolute right-0 top-0 bottom-0 w-72 bg-[#14150f]/95 backdrop-blur-2xl border-l border-white/[0.06] p-4 overflow-y-auto"
                >
                  <RightPanel />
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </PageShell>
    </motion.div>
  );
}

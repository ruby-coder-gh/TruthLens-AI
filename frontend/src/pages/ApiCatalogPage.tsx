import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import LeftSidebar from '../components/api-catalog/LeftSidebar';
import CenterContent from '../components/api-catalog/CenterContent';
import RightPanel from '../components/api-catalog/RightPanel';
import { API_GROUPS } from '../components/api-catalog/data';
import { pageTransition } from '../components/ui';

export default function ApiCatalogPage() {
  const [activeGroup, setActiveGroup] = useState(API_GROUPS[0]?.id || 'auth');
  const [mobilePanel, setMobilePanel] = useState<'sidebar' | 'right' | null>(null);

  const closeMobilePanel = useCallback(() => setMobilePanel(null), []);

  return (
    <motion.div
      variants={pageTransition}
      initial="initial"
      animate="animate"
      exit="exit"
      className="flex flex-col h-full"
    >
      {/* Mobile panel toggles */}
      <div className="flex items-center gap-2 mb-3 sm:hidden">
        <button
          type="button"
          onClick={() => setMobilePanel('sidebar')}
          className="glass rounded-lg px-3 py-1.5 text-xs text-text-muted"
        >
          Groups
        </button>
        <button
          type="button"
          onClick={() => setMobilePanel('right')}
          className="glass rounded-lg px-3 py-1.5 text-xs text-text-muted"
        >
          Tools
        </button>
      </div>

      {/* Three-panel layout */}
      <div className="flex-1 flex gap-4 min-h-0 relative">
        {/* Left Sidebar - desktop */}
        <div className="hidden sm:block">
          <LeftSidebar activeGroup={activeGroup} onGroupChange={setActiveGroup} />
        </div>

        {/* Center Content */}
        <CenterContent activeGroup={activeGroup} />

        {/* Right Panel - desktop */}
        <div className="hidden xl:block">
          <RightPanel />
        </div>

        {/* Mobile panels */}
        <AnimatePresence>
          {mobilePanel === 'sidebar' && (
            <motion.div
              initial={{ opacity: 0.99 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 sm:hidden"
            >
              <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={closeMobilePanel} />
              <motion.div
                initial={{ x: -280 }}
                animate={{ x: 0 }}
                exit={{ x: -280 }}
                className="absolute left-0 top-0 bottom-0 w-64 bg-[#0a0e17]/95 backdrop-blur-2xl border-r border-white/[0.06] p-4"
              >
                <LeftSidebar activeGroup={activeGroup} onGroupChange={(id) => { setActiveGroup(id); closeMobilePanel(); }} />
              </motion.div>
            </motion.div>
          )}
          {mobilePanel === 'right' && (
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
                className="absolute right-0 top-0 bottom-0 w-72 bg-[#0a0e17]/95 backdrop-blur-2xl border-l border-white/[0.06] p-4 overflow-y-auto"
              >
                <RightPanel />
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

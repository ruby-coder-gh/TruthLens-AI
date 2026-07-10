import { useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { staggerContainer, staggerItem } from '../motion';
import HeroSection from './HeroSection';
import StatsRow from './StatsRow';
import SearchBar from './SearchBar';
import EndpointGroup from './EndpointGroup';
import EndpointDetailDrawer from './EndpointDetailDrawer';
import { API_GROUPS } from './data';
import type { ApiEndpoint, HttpMethod } from './types';
import { EmptyState } from '../ui';
import { SearchX } from 'lucide-react';

export default function CenterContent() {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeMethod, setActiveMethod] = useState<HttpMethod | 'ALL'>('ALL');
  const [selectedEndpoint, setSelectedEndpoint] = useState<ApiEndpoint | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const filteredGroups = useMemo(() => {
    return API_GROUPS
      .map((group) => {
        const filtered = group.endpoints.filter((ep) => {
          if (activeMethod !== 'ALL' && ep.method !== activeMethod) return false;
          if (searchQuery) {
            const q = searchQuery.toLowerCase();
            const matchesPath = ep.path.toLowerCase().includes(q);
            const matchesDesc = ep.description.toLowerCase().includes(q);
            const matchesGroup = group.name.toLowerCase().includes(q);
            return matchesPath || matchesDesc || matchesGroup;
          }
          return true;
        });
        return { ...group, endpoints: filtered };
      })
      .filter((g) => g.endpoints.length > 0);
  }, [searchQuery, activeMethod]);

  const hasResults = filteredGroups.length > 0;

  return (
    <>
      <div ref={scrollRef} className="flex-1 min-w-0 overflow-y-auto space-y-4">
        {/* Hero */}
        <HeroSection />

        {/* Stats */}
        <StatsRow />

        {/* Search + filters */}
        <SearchBar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          activeMethod={activeMethod}
          onMethodChange={setActiveMethod}
        />

        {/* Endpoint groups */}
        <AnimatePresence mode="wait">
          {hasResults ? (
            <motion.div
              key="results"
              variants={staggerContainer}
              initial="initial"
              animate="animate"
              className="space-y-2.5"
            >
              {filteredGroups.map((group) => (
                <motion.div
                  key={group.id}
                  variants={staggerItem}
                >
                  <EndpointGroup
                    group={group}
                    defaultOpen={!!searchQuery || activeMethod !== 'ALL'}
                    onSelectEndpoint={setSelectedEndpoint}
                  />
                </motion.div>
              ))}
            </motion.div>
          ) : (
            <motion.div
              key="empty"
              initial={{ opacity: 0.99, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
            >
              <EmptyState
                icon={<SearchX size={28} />}
                title="No endpoints found"
                description="Try adjusting your search or filter criteria"
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Endpoint detail drawer */}
      <EndpointDetailDrawer
        endpoint={selectedEndpoint}
        onClose={() => setSelectedEndpoint(null)}
      />
    </>
  );
}

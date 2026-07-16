import { motion } from 'framer-motion';
import { clsx } from 'clsx';
import { Search, X, SlidersHorizontal } from 'lucide-react';
import type { HttpMethod } from './types';
import { METHOD_COLORS } from './data';

const METHODS: (HttpMethod | 'ALL')[] = ['ALL', 'GET', 'POST', 'PUT', 'DELETE', 'WS'];

interface SearchBarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  activeMethod: HttpMethod | 'ALL';
  onMethodChange: (method: HttpMethod | 'ALL') => void;
}

export default function SearchBar({ searchQuery, onSearchChange, activeMethod, onMethodChange }: SearchBarProps) {
  return (
    <motion.div
      initial={{ opacity: 0.99, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.15 }}
      className="space-y-3"
    >
      {/* Search input */}
      <div className="relative group">
        <Search
          size={16}
          className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-dim transition-colors group-focus-within:text-primary-soft"
        />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search endpoints, routes, descriptions..."
          className="w-full glass-input rounded-xl pl-10 pr-10 py-3 text-sm text-text placeholder-text-dim transition-all focus:outline-none focus:border-primary/40 focus:shadow-[0_0_20px_rgba(232,193,90,0.08)]"
          aria-label="Search API endpoints"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => onSearchChange('')}
            className="absolute right-3.5 top-1/2 -translate-y-1/2 text-text-dim hover:text-text transition-colors p-0.5"
            aria-label="Clear search"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* Method filters */}
      <div className="flex items-center gap-2">
        <SlidersHorizontal size={14} className="text-text-dim shrink-0" />
        <div className="flex flex-wrap gap-1.5">
          {METHODS.map((method) => {
            const isAll = method === 'ALL';
            const isActive = activeMethod === method;
            return (
              <button
                key={method}
                type="button"
                onClick={() => onMethodChange(method)}
                className={clsx(
                  'relative px-2.5 py-1.5 rounded-lg text-[11px] font-bold tracking-wider uppercase transition-all duration-150',
                  'hover:scale-105 active:scale-95',
                  isAll && isActive && 'bg-primary/20 text-primary-soft border border-primary/30',
                  isAll && !isActive && 'bg-card-2 text-text-dim border border-border hover:text-text',
                  !isAll && isActive && `${METHOD_COLORS[method]} border`,
                  !isAll && !isActive && 'bg-card-2 text-text-dim border border-border hover:text-text hover:border-text-dim/30',
                )}
              >
                {method === 'WS' ? 'WS' : method}
              </button>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
}

import { motion } from 'framer-motion';
import {
  Globe,
  Radio,
  Cpu,
  ShieldCheck,
} from 'lucide-react';
import { CATALOG_STATS } from './data';
import AnimatedCounter from './AnimatedCounter';

const statsConfig = [
  {
    value: CATALOG_STATS.httpEndpoints,
    label: 'HTTP Endpoints',
    icon: <Globe size={16} />,
    color: 'from-primary/20 to-primary/5 border-primary/25',
    iconColor: 'text-primary-soft',
  },
  {
    value: CATALOG_STATS.webSocketCount,
    label: 'WebSocket',
    icon: <Radio size={16} />,
    color: 'from-accent/20 to-accent/5 border-accent/25',
    iconColor: 'text-accent',
  },
  {
    value: CATALOG_STATS.backgroundJobs,
    label: 'Background Jobs',
    icon: <Cpu size={16} />,
    color: 'from-accent-2/20 to-accent-2/5 border-accent-2/25',
    iconColor: 'text-accent-2',
  },
  {
    value: CATALOG_STATS.uptime,
    suffix: '%',
    label: 'Uptime',
    icon: <ShieldCheck size={16} />,
    color: 'from-green-500/20 to-green-500/5 border-green-500/25',
    iconColor: 'text-green',
  },
];

export default function StatsRow() {
  return (
    <motion.div
      initial={{ opacity: 0.99, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.1 }}
      className="grid grid-cols-2 sm:grid-cols-4 gap-3"
    >
      {statsConfig.map((stat, i) => (
        <motion.div
          key={stat.label}
          initial={{ opacity: 0.99, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.15 + i * 0.05 }}
          className={`relative overflow-hidden rounded-xl glass border ${stat.color}`}
        >
          <div className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className={stat.iconColor}>{stat.icon}</span>
              <span className="text-[10px] font-semibold uppercase tracking-widest text-text-dim">
                {stat.label}
              </span>
            </div>
            <AnimatedCounter
              value={stat.value}
              suffix={stat.suffix || ''}
              duration={1.5 + i * 0.2}
              className="items-start"
            />
          </div>
          {/* Shine line */}
          <div className="absolute top-0 right-0 w-20 h-full bg-gradient-to-l from-white/[0.03] to-transparent" />
        </motion.div>
      ))}
    </motion.div>
  );
}

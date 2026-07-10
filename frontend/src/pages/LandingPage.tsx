import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Shield,
  Sparkles,
  Search,
  FileText,
  MessageSquare,
  BarChart3,
  Zap,
  ArrowRight,
  ChevronDown,
  Check,
  Code2,
  Globe,
} from 'lucide-react';
import { Button, Card, Badge } from '../components/ui';
import Logo from '../components/Logo';

const features = [
  {
    icon: <Shield size={22} />,
    title: 'Trust Scoring',
    desc: 'Every response is scored from 0-1 using retrieval quality, faithfulness, and source signals.',
  },
  {
    icon: <Search size={22} />,
    title: 'Hybrid Retrieval',
    desc: 'Vector search and BM25 are fused, reranked, and expanded with parent context for precision.',
  },
  {
    icon: <FileText size={22} />,
    title: 'Structured Ingestion',
    desc: 'PDF, DOCX, TXT, MD, and CSV files are chunked, embedded, indexed, and tracked by status.',
  },
  {
    icon: <MessageSquare size={22} />,
    title: 'Streaming Answers',
    desc: 'WebSocket responses stream tokens, sources, guardrail checks, and trust updates in real time.',
  },
  {
    icon: <BarChart3 size={22} />,
    title: 'Admin Analytics',
    desc: 'Audit logs, flagged answers, trust distribution, and usage metrics stay visible in one dashboard.',
  },
  {
    icon: <Zap size={22} />,
    title: 'Fallback-Ready LLM',
    desc: 'Auto-probe OpenAI-compatible APIs with local Ollama fallback for resilient answer generation.',
  },
];

const steps = [
  {
    num: '01',
    title: 'Ingest Documents',
    desc: 'Upload files into workspaces. Background ingestion parses, chunks, and indexes content.',
  },
  {
    num: '02',
    title: 'Ask Questions',
    desc: 'Queries are rewritten, retrieved, reranked, and generated with source-linked responses.',
  },
  {
    num: '03',
    title: 'Inspect Evidence',
    desc: 'Review inline citations, chunk excerpts, and guardrail outputs before taking action.',
  },
  {
    num: '04',
    title: 'Operate at Scale',
    desc: 'Use collections, workspace roles, audits, and admin analytics to run a production workflow.',
  },
];

const trustSignals = [
  { label: 'Faithfulness', value: 96, barColor: 'bg-emerald-400' },
  { label: 'Retrieval quality', value: 92, barColor: 'bg-sky-400' },
  { label: 'Citation coverage', value: 98, barColor: 'bg-amber-400' },
];

const highlights = [
  { value: '0.92', label: 'Average trust score' },
  { value: '50MB', label: 'Per-file upload limit' },
  { value: 'Real-time', label: 'WebSocket answer streaming' },
];

const staggerContainer = { animate: { transition: { staggerChildren: 0.07, delayChildren: 0.08 } } };
const staggerItem = {
  initial: { opacity: 0.99, y: 16 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.16, 1, 0.3, 1] as const } },
};

export default function LandingPage() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-bg">
      <div className="ambient-blob ambient-blob-1" aria-hidden="true" />
      <div className="ambient-blob ambient-blob-2" aria-hidden="true" />
      <div className="ambient-blob ambient-blob-3" aria-hidden="true" />
      <div className="bg-grid" />

      <motion.nav
        initial={{ opacity: 0.99, y: -14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        className="sticky top-0 z-30 border-b border-white/[0.05] bg-bg/80 backdrop-blur-xl"
      >
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <Logo size={20} variant="gradient-bg" />
            <span className="text-base font-semibold tracking-tight text-text sm:text-lg">TruthLens AI</span>
          </div>

          <div className="hidden items-center gap-6 md:flex">
            <button
              type="button"
              onClick={() => scrollTo('features')}
              className="text-sm font-medium text-text-muted transition-colors hover:text-text"
            >
              Features
            </button>
            <button
              type="button"
              onClick={() => scrollTo('how-it-works')}
              className="text-sm font-medium text-text-muted transition-colors hover:text-text"
            >
              Workflow
            </button>
            <Link to="/login" className="text-sm font-medium text-text-muted transition-colors hover:text-text">
              Sign in
            </Link>
            <Link to="/register">
              <Button size="sm">
                Get Started
                <ArrowRight size={14} />
              </Button>
            </Link>
          </div>

          <button
            type="button"
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            className="flex h-10 w-10 items-center justify-center rounded-xl glass text-text-muted md:hidden"
            aria-label="Toggle menu"
          >
            <div className="flex flex-col gap-1">
              <span
                className={`block h-0.5 w-5 bg-current transition-transform ${mobileMenuOpen ? 'translate-y-1.5 rotate-45' : ''}`}
              />
              <span className={`block h-0.5 w-5 bg-current transition-opacity ${mobileMenuOpen ? 'opacity-0' : ''}`} />
              <span
                className={`block h-0.5 w-5 bg-current transition-transform ${mobileMenuOpen ? '-translate-y-1.5 -rotate-45' : ''}`}
              />
            </div>
          </button>
        </div>
      </motion.nav>

      {mobileMenuOpen && (
        <motion.div
          initial={{ opacity: 0.99, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative z-20 mx-4 mt-3 rounded-2xl glass p-4 md:hidden"
        >
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => { scrollTo('features'); setMobileMenuOpen(false); }}
              className="rounded-lg px-3 py-2 text-left text-sm text-text-muted transition-colors hover:bg-white/[0.04] hover:text-text"
            >
              Features
            </button>
            <button
              type="button"
              onClick={() => { scrollTo('how-it-works'); setMobileMenuOpen(false); }}
              className="rounded-lg px-3 py-2 text-left text-sm text-text-muted transition-colors hover:bg-white/[0.04] hover:text-text"
            >
              Workflow
            </button>
            <Link
              to="/login"
              className="rounded-lg px-3 py-2 text-sm text-text-muted transition-colors hover:bg-white/[0.04] hover:text-text"
              onClick={() => setMobileMenuOpen(false)}
            >
              Sign in
            </Link>
            <Link to="/register" onClick={() => setMobileMenuOpen(false)}>
              <Button size="sm" className="mt-1 w-full">Get Started</Button>
            </Link>
          </div>
        </motion.div>
      )}

      <main className="relative z-10 px-4 pb-20 pt-10 sm:px-6 lg:px-8 lg:pt-14">
        <section className="mx-auto grid w-full max-w-6xl gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
          <motion.div
            initial={{ opacity: 0.99, y: 22 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/[0.14] bg-white/[0.03] px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">
              <Sparkles size={12} className="text-accent" />
              Evidence-First RAG Platform
            </div>

            <h1 className="max-w-xl text-4xl font-bold leading-[1.08] tracking-tight text-text sm:text-5xl lg:text-6xl">
              Answers with sources, trust, and auditability.
            </h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-text-muted sm:text-lg">
              TruthLens AI gives teams a grounded QA system over private documents with retrieval evidence, guardrails, and confidence scoring built into every response.
            </p>

            <div className="mt-8 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
              <Link to="/register">
                <Button size="lg">
                  Launch Workspace
                  <ArrowRight size={18} />
                </Button>
              </Link>
              <Button
                variant="secondary"
                size="lg"
                onClick={() => scrollTo('features')}
                className="w-full sm:w-auto"
              >
                Explore Platform
                <ChevronDown size={16} />
              </Button>
            </div>

            <div className="mt-8 grid gap-2 text-sm text-text-muted sm:grid-cols-2">
              <p className="flex items-center gap-2"><Check size={15} className="text-accent" /> Citations linked to source chunks.</p>
              <p className="flex items-center gap-2"><Check size={15} className="text-accent" /> Guardrail verification before final answer.</p>
              <p className="flex items-center gap-2"><Check size={15} className="text-accent" /> API-first backend with workspace ACLs.</p>
              <p className="flex items-center gap-2"><Check size={15} className="text-accent" /> Streaming trust score in real time.</p>
            </div>

            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              {highlights.map((item) => (
                <div key={item.label} className="rounded-2xl border border-white/[0.1] bg-card/70 px-4 py-3">
                  <p className="text-lg font-semibold text-text">{item.value}</p>
                  <p className="text-xs text-text-dim">{item.label}</p>
                </div>
              ))}
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0.99, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.65, delay: 0.08, ease: [0.16, 1, 0.3, 1] }}
            className="relative"
          >
            <div className="pointer-events-none absolute -inset-10 -z-10 rounded-[36px] bg-gradient-to-br from-primary/18 via-accent/12 to-accent-2/18 blur-3xl" />
            <div className="rounded-3xl border border-white/[0.12] bg-card/85 p-6 shadow-[0_28px_70px_rgba(1,4,12,0.45)] backdrop-blur-2xl sm:p-7">
              <div className="mb-5 flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-text">Live Evidence Trace</p>
                  <p className="text-xs text-text-dim">Query session #A-1742</p>
                </div>
                <Badge color="blue">Trust 0.93</Badge>
              </div>

              <div className="rounded-2xl border border-white/[0.08] bg-bg-soft/70 p-4">
                <p className="text-xs uppercase tracking-[0.08em] text-text-dim">Question</p>
                <p className="mt-1 text-sm text-text">
                  What policy changed after Q2 findings and which teams approved it?
                </p>
              </div>

              <div className="mt-4 space-y-2">
                {['Security Policy v4.2 (p.14)', 'Board Minutes June 28', 'Audit Log /workspace/ops'].map((source) => (
                  <div key={source} className="flex items-center justify-between rounded-xl border border-white/[0.08] bg-bg-soft/55 px-3 py-2.5">
                    <p className="text-sm text-text-muted">{source}</p>
                    <span className="text-xs font-medium text-accent">verified</span>
                  </div>
                ))}
              </div>

              <div className="mt-5 space-y-3">
                {trustSignals.map((metric) => (
                  <div key={metric.label}>
                    <div className="mb-1.5 flex items-center justify-between text-xs text-text-dim">
                      <span>{metric.label}</span>
                      <span>{metric.value}%</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
                      <div
                        className={`h-full rounded-full ${metric.barColor}`}
                        style={{ width: `${metric.value}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        </section>

        <section id="features" className="mx-auto mt-24 w-full max-w-6xl">
          <motion.div
            variants={staggerContainer}
            initial="initial"
            whileInView="animate"
            viewport={{ once: true, amount: 0.2 }}
          >
            <motion.div variants={staggerItem} className="mb-11 text-center">
              <Badge color="purple" className="mb-3">Capabilities</Badge>
              <h2 className="text-3xl font-bold tracking-tight text-text sm:text-4xl">
                Built for high-stakes document intelligence
              </h2>
              <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-text-muted sm:text-base">
                The platform is optimized for grounded responses, transparent evidence, and operational control from ingest to analytics.
              </p>
            </motion.div>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {features.map((feature) => (
                <motion.div key={feature.title} variants={staggerItem}>
                  <Card hover className="h-full">
                    <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-white/[0.1] bg-bg-soft/80 text-primary-soft">
                      {feature.icon}
                    </div>
                    <h3 className="text-base font-semibold text-text">{feature.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-text-muted">{feature.desc}</p>
                  </Card>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </section>

        <section id="how-it-works" className="mx-auto mt-24 w-full max-w-6xl">
          <motion.div
            variants={staggerContainer}
            initial="initial"
            whileInView="animate"
            viewport={{ once: true, amount: 0.2 }}
            className="rounded-3xl border border-white/[0.1] bg-card/65 p-6 sm:p-8 lg:p-10"
          >
            <motion.div variants={staggerItem} className="mb-8">
              <Badge color="blue" className="mb-3">Workflow</Badge>
              <h2 className="text-3xl font-bold tracking-tight text-text sm:text-4xl">How TruthLens runs</h2>
            </motion.div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {steps.map((step, index) => (
                <motion.div key={step.num} variants={staggerItem} className="relative">
                  <div className="h-full rounded-2xl border border-white/[0.1] bg-bg-soft/70 p-5">
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-text-dim">{step.num}</p>
                    <h3 className="mt-3 text-base font-semibold text-text">{step.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-text-muted">{step.desc}</p>
                  </div>
                  {index < steps.length - 1 && (
                    <ArrowRight
                      size={16}
                      className="absolute -right-2 top-1/2 hidden -translate-y-1/2 text-text-dim xl:block"
                    />
                  )}
                </motion.div>
              ))}
            </div>
          </motion.div>
        </section>

        <section className="mx-auto mt-24 w-full max-w-5xl">
          <motion.div
            initial={{ opacity: 0.99, y: 22 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden rounded-3xl border border-white/[0.12] bg-gradient-to-br from-card via-bg-soft to-card p-8 text-center sm:p-10"
          >
            <h2 className="text-3xl font-bold tracking-tight text-text sm:text-4xl">Ready to run trustworthy AI in your workspace?</h2>
            <p className="mx-auto mt-4 max-w-2xl text-sm leading-relaxed text-text-muted sm:text-base">
              Move from opaque chatbot answers to source-backed responses with confidence scoring and audit trails.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link to="/register">
                <Button size="lg">
                  Get Started
                  <ArrowRight size={18} />
                </Button>
              </Link>
              <Link to="/login">
                <Button variant="secondary" size="lg">Sign in</Button>
              </Link>
            </div>
          </motion.div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-white/[0.08] px-5 py-8 sm:px-6 lg:px-8">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-5 text-xs sm:flex-row">
          <div className="flex items-center gap-3">
            <Logo size={16} variant="gradient-bg" />
            <span className="text-sm font-semibold text-text">TruthLens AI</span>
          </div>
          <div className="flex items-center gap-5 text-text-muted">
            <span>&copy; {new Date().getFullYear()} TruthLens AI</span>
            <Link to="/privacy" className="transition-colors hover:text-text">Privacy</Link>
            <Link to="/terms" className="transition-colors hover:text-text">Terms</Link>
            <Link to="/contact" className="transition-colors hover:text-text">Contact</Link>
          </div>
          <div className="flex items-center gap-3 text-text-muted">
            <a href="#" aria-label="GitHub" className="transition-colors hover:text-text"><Code2 size={16} /></a>
            <a href="#" aria-label="Twitter" className="transition-colors hover:text-text"><Globe size={16} /></a>
          </div>
        </div>
      </footer>
    </div>
  );
}

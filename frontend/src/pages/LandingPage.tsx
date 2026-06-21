import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Shield, Sparkles, Search, FileText, MessageSquare, BarChart3, Zap, ArrowRight, ChevronDown, Check, Code2, Globe } from 'lucide-react';
import { Button, Card, Badge } from '../components/ui';

// ─── Feature Data ──────────────────────────────────────────────────────────────

const features = [
  { icon: <Shield size={24} />, title: 'Trust Scoring', desc: 'Every response scored for truthfulness (0–1) using multi-model consensus.' },
  { icon: <Search size={24} />, title: 'RAG-Powered Retrieval', desc: 'Semantic search across your documents with re-ranking for precision.' },
  { icon: <FileText size={24} />, title: 'Document Ingestion', desc: 'Upload PDFs, DOCX, TXT — auto-chunked, embedded, and indexed.' },
  { icon: <MessageSquare size={24} />, title: 'Conversational Q&A', desc: 'Natural conversation interface that cites sources for every claim.' },
  { icon: <BarChart3 size={24} />, title: 'Guardrails & Safety', desc: 'Built-in content guardrails prevent hallucination and unsafe output.' },
  { icon: <Zap size={24} />, title: 'Lightning Fast', desc: 'Streaming responses with real-time trust score updates as you type.' },
];

const steps = [
  { num: '01', title: 'Connect Your Data', desc: 'Upload documents or connect existing knowledge bases to your workspace.' },
  { num: '02', title: 'Ask Questions', desc: 'Type any question — the system retrieves relevant context from your documents.' },
  { num: '03', title: 'Review Trust Scores', desc: 'Each answer scored on faithfulness, relevance, and source quality.' },
  { num: '04', title: 'Investigate Deeply', desc: 'Drill into sources, compare evidence, and build comprehensive reports.' },
];

// ─── Stagger Variants ──────────────────────────────────────────────────────────

const staggerContainer = { animate: { transition: { staggerChildren: 0.06, delayChildren: 0.1 } } };
const staggerItem = {
  initial: { opacity: 0.99, y: 20 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] as const } },
};

// ─── Component ─────────────────────────────────────────────────────────────────

export default function LandingPage() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="relative min-h-screen bg-bg overflow-hidden">
      {/* Ambient blobs */}
      <div className="ambient-blob ambient-blob-1" aria-hidden="true" />
      <div className="ambient-blob ambient-blob-2" aria-hidden="true" />
      <div className="ambient-blob ambient-blob-3" aria-hidden="true" />
      <div className="bg-grid" />

      {/* ─── Navbar ──────────────────────────────────────────────────────── */}
      <motion.nav
        initial={{ opacity: 0.99, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-20 flex items-center justify-between px-6 py-4 lg:px-12"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-accent text-white">
            <Shield size={18} />
          </div>
          <span className="text-lg font-bold text-text">TruthLens AI</span>
        </div>

        {/* Desktop nav */}
        <div className="hidden md:flex items-center gap-6">
          <button onClick={() => scrollTo('features')} className="text-sm text-text-muted hover:text-text transition-colors">Features</button>
          <button onClick={() => scrollTo('how-it-works')} className="text-sm text-text-muted hover:text-text transition-colors">How it works</button>
          <Link to="/login" className="text-sm text-text-muted hover:text-text transition-colors">Sign in</Link>
          <Link to="/register">
            <Button size="sm">
              Get Started <ArrowRight size={14} />
            </Button>
          </Link>
        </div>

        {/* Mobile menu button */}
        <button
          type="button"
          onClick={() => setMobileMenuOpen((p) => !p)}
          className="md:hidden flex items-center justify-center w-9 h-9 rounded-lg glass text-text-muted"
          aria-label="Toggle menu"
        >
          <div className="flex flex-col gap-1">
            <span className={`block h-0.5 w-5 bg-current transition-transform ${mobileMenuOpen ? 'rotate-45 translate-y-1.5' : ''}`} />
            <span className={`block h-0.5 w-5 bg-current transition-opacity ${mobileMenuOpen ? 'opacity-0' : ''}`} />
            <span className={`block h-0.5 w-5 bg-current transition-transform ${mobileMenuOpen ? '-rotate-45 -translate-y-1.5' : ''}`} />
          </div>
        </button>
      </motion.nav>

      {/* Mobile menu */}
      {mobileMenuOpen && (
        <motion.div
          initial={{ opacity: 0.99, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative z-20 mx-4 mb-4 rounded-xl glass p-4 md:hidden"
        >
          <div className="flex flex-col gap-3">
            <button onClick={() => { scrollTo('features'); setMobileMenuOpen(false); }} className="text-sm text-text-muted hover:text-text transition-colors text-left px-3 py-2 rounded-lg hover:bg-white/[0.04]">Features</button>
            <button onClick={() => { scrollTo('how-it-works'); setMobileMenuOpen(false); }} className="text-sm text-text-muted hover:text-text transition-colors text-left px-3 py-2 rounded-lg hover:bg-white/[0.04]">How it works</button>
            <Link to="/login" className="text-sm text-text-muted hover:text-text transition-colors px-3 py-2 rounded-lg hover:bg-white/[0.04]" onClick={() => setMobileMenuOpen(false)}>Sign in</Link>
            <Link to="/register" onClick={() => setMobileMenuOpen(false)}>
              <Button size="sm" className="w-full">Get Started</Button>
            </Link>
          </div>
        </motion.div>
      )}

      {/* ─── Hero Section ────────────────────────────────────────────────── */}
      <section className="relative z-10 flex flex-col items-center justify-center px-4 pt-20 pb-16 text-center lg:pt-32 lg:pb-24">
        <motion.div
          initial={{ opacity: 0.99, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          className="max-w-4xl"
        >
          <motion.div
            initial={{ opacity: 0.99, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="mb-6 inline-flex items-center gap-2 rounded-full glass px-4 py-1.5 text-xs text-text-muted"
          >
            <Sparkles size={12} className="text-accent" />
            AI-Powered Truth Verification Platform
          </motion.div>

          <motion.h1
            initial={{ opacity: 0.99, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="text-4xl font-bold leading-tight sm:text-5xl lg:text-6xl"
          >
            <span className="gradient-text">Trustworthy AI</span>
            <br />
            <span className="text-text">for Critical Decisions</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0.99, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.35 }}
            className="mx-auto mt-5 max-w-2xl text-base text-text-muted leading-relaxed lg:text-lg"
          >
            TruthLens AI combines Retrieval-Augmented Generation with multi-model trust scoring to deliver verifiable, citation-backed answers from your documents.
          </motion.p>

          <motion.div
            initial={{ opacity: 0.99, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.5 }}
            className="mt-8 flex flex-col items-center gap-4 sm:flex-row sm:justify-center"
          >
            <Link to="/register">
              <Button size="lg" className="w-full sm:w-auto">
                Get Started <ArrowRight size={18} />
              </Button>
            </Link>
            <Button
              variant="secondary"
              size="lg"
              className="w-full sm:w-auto"
              onClick={() => scrollTo('features')}
            >
              View Demo <ChevronDown size={16} />
            </Button>
          </motion.div>
        </motion.div>

        {/* Decorative gradient line */}
        <motion.div
          initial={{ scaleX: 0, opacity: 0.99 }}
          animate={{ scaleX: 1, opacity: 1 }}
          transition={{ delay: 0.8, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          className="mt-16 h-px w-full max-w-2xl bg-gradient-to-r from-transparent via-primary/30 to-transparent"
          aria-hidden="true"
        />
      </section>

      {/* ─── Features Section ────────────────────────────────────────────── */}
      <section id="features" className="relative z-10 px-4 py-16 lg:py-24">
        <motion.div
          variants={staggerContainer}
          initial="initial"
          whileInView="animate"
          viewport={{ once: true, amount: 0.2 }}
          className="mx-auto max-w-6xl"
        >
          <motion.div variants={staggerItem} className="mb-12 text-center">
            <Badge color="purple" className="mb-3">Features</Badge>
            <h2 className="text-3xl font-bold text-text lg:text-4xl">Everything you need for <span className="gradient-text">trustworthy AI</span></h2>
            <p className="mt-3 text-sm text-text-muted max-w-xl mx-auto">
              From document ingestion to truth-scored answers — a complete pipeline for AI-powered document analysis.
            </p>
          </motion.div>

          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f, i) => (
              <motion.div key={i} variants={staggerItem}>
                <Card hover className="h-full group">
                  <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl glass text-primary-soft group-hover:scale-110 transition-transform duration-300">
                    {f.icon}
                  </div>
                  <h3 className="mb-2 text-base font-semibold text-text">{f.title}</h3>
                  <p className="text-sm text-text-muted leading-relaxed">{f.desc}</p>
                </Card>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </section>

      {/* ─── How It Works Section ────────────────────────────────────────── */}
      <section id="how-it-works" className="relative z-10 px-4 py-16 lg:py-24">
        <motion.div
          variants={staggerContainer}
          initial="initial"
          whileInView="animate"
          viewport={{ once: true, amount: 0.2 }}
          className="mx-auto max-w-6xl"
        >
          <motion.div variants={staggerItem} className="mb-12 text-center">
            <Badge color="blue" className="mb-3">Process</Badge>
            <h2 className="text-3xl font-bold text-text lg:text-4xl">How it <span className="gradient-text">works</span></h2>
            <p className="mt-3 text-sm text-text-muted max-w-xl mx-auto">
              Four simple steps from uploading documents to getting trustworthy answers.
            </p>
          </motion.div>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((step, i) => (
              <motion.div key={i} variants={staggerItem} className="relative">
                <div className="rounded-2xl glass p-6 text-center h-full">
                  <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-primary/20 to-accent/20 border border-primary/20">
                    <span className="text-lg font-bold gradient-text">{step.num}</span>
                  </div>
                  <h3 className="mb-2 text-base font-semibold text-text">{step.title}</h3>
                  <p className="text-sm text-text-muted">{step.desc}</p>
                </div>
                {i < steps.length - 1 && (
                  <div className="hidden lg:block absolute top-1/2 -right-3 text-text-dim" aria-hidden="true">
                    <ArrowRight size={20} />
                  </div>
                )}
              </motion.div>
            ))}
          </div>
        </motion.div>
      </section>

      {/* ─── CTA Section ─────────────────────────────────────────────────── */}
      <section className="relative z-10 px-4 py-16 lg:py-24">
        <motion.div
          initial={{ opacity: 0.99, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="mx-auto max-w-3xl text-center"
        >
          <Card className="relative overflow-hidden p-8 lg:p-12">
            <div className="pointer-events-none absolute -inset-x-20 -top-40 h-80 w-[calc(100%+160px)] opacity-30" style={{ background: 'radial-gradient(ellipse 80% 60% at 50% -20%, rgba(124,92,255,0.15), transparent)' }} aria-hidden="true" />
            <div className="relative z-10">
              <h2 className="text-2xl font-bold text-text lg:text-3xl">Ready to build <span className="gradient-text">trustworthy AI</span>?</h2>
              <p className="mt-3 text-sm text-text-muted max-w-lg mx-auto">
                Start asking questions that come with sources and trust scores you can rely on.
              </p>
              <div className="mt-8 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
                <Link to="/register">
                  <Button size="lg">
                    Get Started Free <ArrowRight size={18} />
                  </Button>
                </Link>
                <Link to="/login">
                  <Button variant="secondary" size="lg">Sign in</Button>
                </Link>
              </div>
            </div>
          </Card>
        </motion.div>
      </section>

      {/* ─── Footer ──────────────────────────────────────────────────────── */}
      <footer className="relative z-10 border-t border-white/[0.06] px-6 py-8 lg:px-12">
        <div className="mx-auto max-w-6xl">
          <div className="flex flex-col items-center justify-between gap-6 sm:flex-row">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-accent text-white">
                <Shield size={14} />
              </div>
              <span className="text-sm font-semibold text-text">TruthLens AI</span>
            </div>
            <div className="flex items-center gap-6 text-xs text-text-muted">
              <span>&copy; {new Date().getFullYear()} TruthLens AI</span>
              <Link to="/privacy" className="hover:text-text transition-colors">Privacy</Link>
              <Link to="/terms" className="hover:text-text transition-colors">Terms</Link>
              <Link to="/contact" className="hover:text-text transition-colors">Contact</Link>
            </div>
            <div className="flex items-center gap-3 text-text-muted">
              <a href="#" aria-label="GitHub" className="hover:text-text transition-colors"><Code2 size={16} /></a>
              <a href="#" aria-label="Twitter" className="hover:text-text transition-colors"><Globe size={16} /></a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

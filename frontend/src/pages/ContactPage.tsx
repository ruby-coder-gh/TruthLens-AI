import { Mail, MessageSquare, Code2 } from 'lucide-react';
import { Card } from '../components/ui';
import LegalPageLayout from '../components/LegalPageLayout';

export default function ContactPage() {
  return (
    <LegalPageLayout
      title="Contact Us"
      icon={<MessageSquare size={20} className="text-primary-soft" />}
    >
      <p>Have questions, feedback, or need help? We&apos;d love to hear from you.</p>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="border-white/[0.06] bg-white/[0.03] p-5">
          <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
            <Mail size={18} className="text-primary-soft" />
          </div>
          <h3 className="mb-1 font-medium text-text">Email</h3>
          <p className="text-xs text-text-dim">
            <a href="mailto:hello@truthlens.ai" className="text-primary-soft transition-colors hover:text-primary">
              hello@truthlens.ai
            </a>
          </p>
        </Card>

        <Card className="border-white/[0.06] bg-white/[0.03] p-5">
          <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-accent/10">
            <Code2 size={18} className="text-accent" />
          </div>
          <h3 className="mb-1 font-medium text-text">GitHub</h3>
          <p className="text-xs text-text-dim">
            <a
              href="https://github.com/truthlens-ai"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary-soft transition-colors hover:text-primary"
            >
              @truthlens-ai
            </a>
          </p>
        </Card>
      </div>

      <p className="pt-1 text-xs text-text-dim">We aim to respond within 24 hours during business days.</p>
    </LegalPageLayout>
  );
}

import { Shield } from 'lucide-react';
import LegalPageLayout from '../components/LegalPageLayout';

export default function PrivacyPage() {
  return (
    <LegalPageLayout
      title="Privacy Policy"
      icon={<Shield size={20} className="text-primary-soft" />}
    >
      <p>
        TruthLens AI (&quot;we,&quot; &quot;our,&quot; or &quot;us&quot;) is committed to protecting your privacy.
        This Privacy Policy explains how we collect, use, disclose, and safeguard your
        information when you use our platform.
      </p>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-text">Information We Collect</h2>
        <p>
          We collect information you provide directly to us, including account details
          (email, name), documents you upload, and content you generate through our
          platform. We also collect usage data such as interaction logs and analytics
          to improve our service.
        </p>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-text">How We Use Your Information</h2>
        <p>
          Your information is used to provide, maintain, and improve our services;
          process your requests; send technical notices and support messages; and
          detect, investigate, and prevent fraudulent transactions and abuse.
        </p>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-text">Data Security</h2>
        <p>
          We implement industry-standard security measures including encryption at rest
          and in transit, access controls, and regular security audits. Your documents
          and analysis results are stored securely and never shared with third parties
          without your explicit consent.
        </p>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-text">Contact</h2>
        <p>
          If you have questions about this Privacy Policy, please contact us at{' '}
          <a href="mailto:privacy@truthlens.ai" className="text-primary-soft transition-colors hover:text-primary">
            privacy@truthlens.ai
          </a>.
        </p>
      </section>
    </LegalPageLayout>
  );
}

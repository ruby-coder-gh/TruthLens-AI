import { Scale } from 'lucide-react';
import LegalPageLayout from '../components/LegalPageLayout';

export default function TermsPage() {
  return (
    <LegalPageLayout
      title="Terms of Service"
      icon={<Scale size={20} className="text-primary-soft" />}
    >
      <p>
        By accessing or using TruthLens AI (&quot;the Service&quot;), you agree to be bound
        by these Terms of Service. If you do not agree, do not use the Service.
      </p>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-text">Use of Service</h2>
        <p>
          You are responsible for maintaining the confidentiality of your account
          credentials and for all activities under your account. You agree not to
          use the Service for any unlawful purpose or in violation of any applicable
          laws or regulations.
        </p>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-text">Intellectual Property</h2>
        <p>
          You retain ownership of any content you upload to the Service. TruthLens AI
          does not claim ownership over your documents or generated content. We claim
          no intellectual property rights over the material you provide.
        </p>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-text">Limitation of Liability</h2>
        <p>
          The Service is provided &quot;as is&quot; without warranties of any kind. TruthLens AI
          shall not be liable for any direct, indirect, incidental, or consequential
          damages arising from your use of the Service.
        </p>
      </section>
    </LegalPageLayout>
  );
}

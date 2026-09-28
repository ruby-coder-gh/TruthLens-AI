// Owning lane: L4 (Receipt FE). Scaffold stub — the public "Ledger and Seal"
// view (claims + verdicts, evidence, trust gauge, seal verification, print
// CSS) is L4's to build against `api.receipts.get(token)`.
import { useParams } from 'react-router-dom';

export default function ReceiptPage() {
  const { token } = useParams<{ token: string }>();

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4 text-text">
      <p className="text-sm text-text-dim">Truth Receipt {token ?? ''}</p>
    </div>
  );
}

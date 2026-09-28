// Owning lane: L10 (Demo FE). Scaffold stub — renders the caller-provided
// fallback questions as plain buttons; the tailored `demoApi.suggestions()`
// fetch + styling is L10's to build.
import { Button } from './ui';

export function SuggestedQuestions({
  workspaceId,
  onPick,
  fallback,
}: {
  workspaceId: string;
  onPick: (q: string) => void;
  fallback: string[];
}) {
  void workspaceId;

  if (fallback.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {fallback.map((question) => (
        <Button key={question} type="button" variant="secondary" size="sm" onClick={() => onPick(question)}>
          {question}
        </Button>
      ))}
    </div>
  );
}

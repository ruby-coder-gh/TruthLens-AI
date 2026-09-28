import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../test/utils';
import EvidenceSidebar from './EvidenceSidebar';
import { useSourceViewer } from '../context/SourceViewerContext';
import type { Source } from '../api/types';

// The full source-viewer wiring (locate fetch, pdf.js, focus trap) is
// covered by SourceViewerContext.test.tsx — here we only need to assert
// that EvidenceSidebar calls `open()` with the right target.
vi.mock('../context/SourceViewerContext', () => ({
  useSourceViewer: vi.fn(),
}));

const mockUseSourceViewer = vi.mocked(useSourceViewer);
const mockOpen = vi.fn();

const baseSource: Source = {
  chunk_id: 'chunk-1',
  document_id: 'doc-1',
  document_name: 'Policy.pdf',
  excerpt: 'Some cited excerpt text.',
  relevance_score: 0.9,
  page_number: 4,
};

function renderSidebar(sources: Source[]) {
  return renderWithProviders(
    <EvidenceSidebar
      sources={sources}
      guardrail={null}
      trustScore={0.8}
      trustComponents={{}}
      isLoading={false}
      sidebarOpen
      onToggleSidebar={vi.fn()}
      workspaceId="ws-1"
      expandedSourceId={sources[0]?.chunk_id ?? null}
      onToggleSource={vi.fn()}
    />,
    { route: '/workspaces/ws-1/chat' },
  );
}

describe('EvidenceSidebar — source viewer integration', () => {
  beforeEach(() => {
    mockOpen.mockReset();
    mockUseSourceViewer.mockReturnValue({ open: mockOpen, close: vi.fn(), target: null });
  });

  it('"View in document" opens the source viewer at the source\'s workspace/document/chunk', async () => {
    const user = userEvent.setup();
    renderSidebar([baseSource]);

    await user.click(screen.getByRole('button', { name: /View in document/i }));

    expect(mockOpen).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      documentId: 'doc-1',
      chunkId: 'chunk-1',
      documentName: 'Policy.pdf',
      pageNumber: 4,
    });
  });

  it('shows a conflicts chip linking to the Radar tab when the source has open conflicts', () => {
    renderSidebar([{ ...baseSource, conflicts: 2 }]);

    const chip = screen.getByRole('link', { name: /Conflicts with another document/i });
    expect(chip).toHaveAttribute('href', '/workspaces/ws-1?tab=radar');
  });

  it('does not show a conflicts chip when there are no open conflicts', () => {
    renderSidebar([baseSource]);

    expect(screen.queryByText(/Conflicts with another document/i)).not.toBeInTheDocument();
  });
});

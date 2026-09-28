import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../test/utils';
import AdminUploadPage from './AdminUploadPage';

const { list, upload } = vi.hoisted(() => ({
  list: vi.fn(),
  upload: vi.fn(),
}));

vi.mock('../api/client', () => ({
  workspaceApi: { list },
  documentApi: { upload },
}));

const WORKSPACE = { id: 'ws-1', name: 'Acme', owner_id: 'u-1', member_count: 1, document_count: 0, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' };

function makeFile(name: string) {
  return new File(['hello'], name, { type: 'text/plain' });
}

// R2-15: after the batch finished, the button stayed visible, disabled, and
// read "Upload 0 file" — a dead control instead of just disappearing.
describe('AdminUploadPage — Upload button after the batch completes (R2-15)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    list.mockResolvedValue({ data: [WORKSPACE] });
  });

  it('hides the Upload button once nothing is pending, leaving only View Documents', async () => {
    upload.mockResolvedValue({ id: 'doc-1' });
    const user = userEvent.setup();
    const { container } = renderWithProviders(<AdminUploadPage />);

    await screen.findByText('Browse Files');
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, makeFile('note.txt'));

    const uploadButton = await screen.findByRole('button', { name: /^upload 1 file$/i });
    await user.click(uploadButton);

    await waitFor(() => expect(screen.getByRole('button', { name: /view documents/i })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /upload 0 file/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^upload/i })).not.toBeInTheDocument();
  });

  it('keeps the Upload button while a file is still pending', async () => {
    const user = userEvent.setup();
    const { container } = renderWithProviders(<AdminUploadPage />);

    await screen.findByText('Browse Files');
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, makeFile('note.txt'));

    expect(await screen.findByRole('button', { name: /^upload 1 file$/i })).toBeInTheDocument();
  });
});

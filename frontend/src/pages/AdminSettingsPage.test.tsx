import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../test/utils';
import AdminSettingsPage from './AdminSettingsPage';

const { getSettings, updateSettings } = vi.hoisted(() => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
}));

vi.mock('../api/client', () => ({
  adminApi: { getSettings, updateSettings },
}));

// C6 — the exact shape `GET /admin/settings` returns
// (`backend/app/schemas/analytics.py::AdminSettingsResponse`).
const SETTINGS = {
  app_name: 'VeritasRAG',
  app_version: '1.4.2',
  max_upload_size_mb: 50,
  trust_score_high_threshold: 0.7,
  trust_score_low_threshold: 0.4,
  rate_limit_enabled: true,
  rate_limit_requests: 60,
  rate_limit_window_seconds: 60,
};

describe('AdminSettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSettings.mockResolvedValue(SETTINGS);
    updateSettings.mockResolvedValue(SETTINGS);
  });

  // BUG-11/C6: the page used to show made-up defaults (workspace name
  // "TruthLens AI", thresholds 0.75/0.50) instead of the server's actual
  // values, and posted fields the backend doesn't understand.
  it('shows the server values, not hardcoded defaults', async () => {
    renderWithProviders(<AdminSettingsPage />);

    expect(await screen.findByText('VeritasRAG')).toBeInTheDocument();
    expect(screen.getByText('1.4.2')).toBeInTheDocument();
    expect(screen.getByDisplayValue('50')).toBeInTheDocument();
    expect(screen.getByText('0.70')).toBeInTheDocument();
    expect(screen.getByText('0.40')).toBeInTheDocument();
    // Not accepted by AdminSettingsUpdate — rendered as fact, not an input.
    expect(screen.getByText('60 requests')).toBeInTheDocument();
    expect(screen.getByText('60s window')).toBeInTheDocument();
  });

  it('saves only fields the backend update schema accepts', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminSettingsPage />);

    const uploadInput = await screen.findByLabelText('Max upload size (MB)');
    await user.clear(uploadInput);
    await user.type(uploadInput, '80');
    const uploadsCard = uploadInput.closest('.glass') as HTMLElement;
    await user.click(within(uploadsCard).getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(updateSettings).toHaveBeenCalledWith({ max_upload_size_mb: 80 }));
  });

  // R2-14: the card had a live checkbox + Save button sitting right next to
  // copy that says "set via server config, not editable here" — pick one.
  it('renders the Rate Limiting card fully read-only, with no checkbox or dead Save', async () => {
    renderWithProviders(<AdminSettingsPage />);

    const heading = await screen.findByRole('heading', { name: /rate limiting/i });
    const card = heading.closest('.glass') as HTMLElement;

    expect(within(card).getByText('Enabled')).toBeInTheDocument();
    expect(within(card).queryByRole('checkbox')).not.toBeInTheDocument();
    expect(within(card).queryByRole('button')).not.toBeInTheDocument();
  });

  it('saves trust thresholds under the backend field names', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminSettingsPage />);

    await screen.findByText('VeritasRAG');
    await user.click(screen.getByRole('button', { name: /save thresholds/i }));

    await waitFor(() => expect(updateSettings).toHaveBeenCalledWith({
      trust_score_high_threshold: SETTINGS.trust_score_high_threshold,
      trust_score_low_threshold: SETTINGS.trust_score_low_threshold,
    }));
  });
});

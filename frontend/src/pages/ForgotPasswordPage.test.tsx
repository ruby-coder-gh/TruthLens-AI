import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../test/utils';
import ForgotPasswordPage from './ForgotPasswordPage';

const { mockForgotPassword } = vi.hoisted(() => ({ mockForgotPassword: vi.fn() }));

vi.mock('../api/client', () => ({
  authApi: { forgotPassword: mockForgotPassword },
}));

beforeEach(() => {
  mockForgotPassword.mockReset();
});

describe('ForgotPasswordPage (BUG-45)', () => {
  it('shows the invalid-email message once, not in a banner and the field', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ForgotPasswordPage />);

    await user.type(screen.getByLabelText(/email/i), 'not-an-email');
    await user.click(screen.getByRole('button', { name: /send reset link/i }));

    expect(await screen.findAllByText('Invalid email format')).toHaveLength(1);
    expect(mockForgotPassword).not.toHaveBeenCalled();
  });

  it('keeps the icon and label of Send reset link on the same row', () => {
    renderWithProviders(<ForgotPasswordPage />);

    const button = screen.getByRole('button', { name: /send reset link/i });
    // The icon and label share one flex row only when the icon goes through
    // PremiumButton's `icon` prop — as a child it renders outside that row.
    const flexRow = button.querySelector('.flex.items-center.gap-2');
    expect(flexRow?.querySelector('svg')).toBeInTheDocument();
    expect(flexRow).toHaveTextContent('Send reset link');
  });

  it('shows "Back to login" once the email is sent, not twice', async () => {
    mockForgotPassword.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderWithProviders(<ForgotPasswordPage />);

    await user.type(screen.getByLabelText(/email/i), 'a@b.com');
    await user.click(screen.getByRole('button', { name: /send reset link/i }));

    await waitFor(() => expect(screen.getByText('Email sent')).toBeInTheDocument());
    expect(screen.getAllByRole('link', { name: /back to login/i })).toHaveLength(1);
  });
});

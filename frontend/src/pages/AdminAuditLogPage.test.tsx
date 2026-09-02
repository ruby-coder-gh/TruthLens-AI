import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../test/utils';
import AdminAuditLogPage from './AdminAuditLogPage';
import { adminApi } from '../api/client';
import { downloadBlob } from '../utils/download';
import { ToastProvider } from '../components/ui';
import type { PaginatedResponse, AuditLogEntry } from '../api/types';

vi.mock('../api/client', () => ({
  adminApi: {
    logs: vi.fn(),
    exportLogs: vi.fn(),
  },
}));

vi.mock('../utils/download', () => ({
  downloadBlob: vi.fn(),
}));

const mockedAdminApi = vi.mocked(adminApi, true);
const mockedDownloadBlob = vi.mocked(downloadBlob);

const SAMPLE_LOGS: PaginatedResponse<AuditLogEntry> = {
  data: [
    {
      id: 'log-1',
      user_id: 'user-1',
      action: 'user.login',
      resource_type: 'user',
      resource_id: 'user-1',
      details: { ip: '127.0.0.1' },
      created_at: '2026-08-15T10:00:00Z',
    },
  ],
  meta: { total: 1, page: 1, page_size: 10 },
};

describe('AdminAuditLogPage — filters and export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedAdminApi.logs.mockResolvedValue(SAMPLE_LOGS);
  });

  it('passes date-from/date-to filters through to adminApi.logs, with date_to as end-of-day', async () => {
    renderWithProviders(<AdminAuditLogPage />);
    await screen.findByText('user.login');

    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-08-01' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-08-31' } });

    await waitFor(() => {
      expect(mockedAdminApi.logs).toHaveBeenCalledWith(
        expect.objectContaining({
          date_from: '2026-08-01T00:00:00.000',
          date_to: '2026-08-31T23:59:59.999',
        }),
      );
    });
  });

  it('passes the user-id filter through to adminApi.logs', async () => {
    renderWithProviders(<AdminAuditLogPage />);
    await screen.findByText('user.login');

    await userEvent.type(screen.getByPlaceholderText(/filter by user id/i), 'user-42');

    await waitFor(() => {
      expect(mockedAdminApi.logs).toHaveBeenCalledWith(
        expect.objectContaining({ user_id: 'user-42' }),
      );
    });
  });

  it('calls exportLogs("json", filters) then downloadBlob on Export JSON', async () => {
    mockedAdminApi.exportLogs.mockResolvedValue({
      blob: new Blob(['[]'], { type: 'application/json' }),
      filename: 'audit-log-20260101T000000Z.json',
    });

    renderWithProviders(<AdminAuditLogPage />);
    await screen.findByText('user.login');

    await userEvent.type(screen.getByPlaceholderText(/filter by user id/i), 'user-42');
    await userEvent.click(screen.getByRole('button', { name: /export json/i }));

    await waitFor(() => {
      expect(mockedAdminApi.exportLogs).toHaveBeenCalledWith(
        'json',
        expect.objectContaining({ user_id: 'user-42' }),
      );
    });
    expect(mockedDownloadBlob).toHaveBeenCalledWith(
      expect.any(Blob),
      'audit-log-20260101T000000Z.json',
    );
  });

  it('calls exportLogs("csv", filters) then downloadBlob on Export CSV', async () => {
    mockedAdminApi.exportLogs.mockResolvedValue({
      blob: new Blob(['id,action'], { type: 'text/csv' }),
      filename: 'audit-log-20260101T000000Z.csv',
    });

    renderWithProviders(<AdminAuditLogPage />);
    await screen.findByText('user.login');

    await userEvent.click(screen.getByRole('button', { name: /export csv/i }));

    await waitFor(() => {
      expect(mockedAdminApi.exportLogs).toHaveBeenCalledWith('csv', expect.any(Object));
    });
    expect(mockedDownloadBlob).toHaveBeenCalledWith(
      expect.any(Blob),
      'audit-log-20260101T000000Z.csv',
    );
  });

  it('shows an error toast when export fails', async () => {
    mockedAdminApi.exportLogs.mockRejectedValue(new Error('Export blew up'));

    renderWithProviders(
      <ToastProvider>
        <AdminAuditLogPage />
      </ToastProvider>,
    );
    await screen.findByText('user.login');

    await userEvent.click(screen.getByRole('button', { name: /export csv/i }));

    await waitFor(() => expect(mockedAdminApi.exportLogs).toHaveBeenCalled());
    expect(await screen.findByText('Export blew up')).toBeInTheDocument();
    expect(mockedDownloadBlob).not.toHaveBeenCalled();
  });

  it('sends an end-of-day date_to on export as well as on the list query', async () => {
    mockedAdminApi.exportLogs.mockResolvedValue({
      blob: new Blob(['id,action'], { type: 'text/csv' }),
      filename: 'audit-log-20260101T000000Z.csv',
    });

    renderWithProviders(<AdminAuditLogPage />);
    await screen.findByText('user.login');

    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-08-31' } });
    await userEvent.click(screen.getByRole('button', { name: /export csv/i }));

    await waitFor(() => {
      expect(mockedAdminApi.exportLogs).toHaveBeenCalledWith(
        'csv',
        expect.objectContaining({ date_to: '2026-08-31T23:59:59.999' }),
      );
    });
  });
});

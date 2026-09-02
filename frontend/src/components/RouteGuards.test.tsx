import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { Routes, Route } from 'react-router-dom';
import { renderWithProviders } from '../test/utils';
import { ProtectedRoute, AdminRoute } from './RouteGuards';
import type { User } from '../api/types';

const adminUser: User = {
  id: 'admin-1',
  email: 'admin@example.com',
  username: 'admin',
  role: 'admin',
  is_active: true,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
};

const memberUser: User = { ...adminUser, id: 'user-1', username: 'member', role: 'member' };

describe('ProtectedRoute', () => {
  it('redirects unauthenticated users to /login', () => {
    renderWithProviders(
      <Routes>
        <Route path="/login" element={<div>Login Page</div>} />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <div>Dashboard</div>
            </ProtectedRoute>
          }
        />
      </Routes>,
      { route: '/dashboard', authValue: { isAuthenticated: false, isLoading: false } },
    );

    expect(screen.getByText('Login Page')).toBeInTheDocument();
    expect(screen.queryByText('Dashboard')).not.toBeInTheDocument();
  });

  it('renders the protected child when authenticated', () => {
    renderWithProviders(
      <Routes>
        <Route path="/login" element={<div>Login Page</div>} />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <div>Dashboard</div>
            </ProtectedRoute>
          }
        />
      </Routes>,
      {
        route: '/dashboard',
        authValue: { isAuthenticated: true, isLoading: false, user: memberUser },
      },
    );

    expect(screen.getByText('Dashboard')).toBeInTheDocument();
  });
});

describe('AdminRoute', () => {
  it('redirects non-admin users to /dashboard', () => {
    renderWithProviders(
      <Routes>
        <Route path="/dashboard" element={<div>User Dashboard</div>} />
        <Route element={<AdminRoute />}>
          <Route path="/admin" element={<div>Admin Page</div>} />
        </Route>
      </Routes>,
      {
        route: '/admin',
        authValue: { isAuthenticated: true, isLoading: false, user: memberUser },
      },
    );

    expect(screen.getByText('User Dashboard')).toBeInTheDocument();
    expect(screen.queryByText('Admin Page')).not.toBeInTheDocument();
  });

  it('renders the nested route for admins', () => {
    renderWithProviders(
      <Routes>
        <Route path="/dashboard" element={<div>User Dashboard</div>} />
        <Route element={<AdminRoute />}>
          <Route path="/admin" element={<div>Admin Page</div>} />
        </Route>
      </Routes>,
      {
        route: '/admin',
        authValue: { isAuthenticated: true, isLoading: false, user: adminUser },
      },
    );

    expect(screen.getByText('Admin Page')).toBeInTheDocument();
  });
});

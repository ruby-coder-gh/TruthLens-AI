import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, useAuth } from './context/AuthContext'
import { ToastProvider } from './components/ui'
import Layout from './components/Layout'
import AdminLayout from './components/AdminLayout'
import type { ReactNode } from 'react'

// Public pages
import LandingPage from './pages/LandingPage'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import ForgotPasswordPage from './pages/ForgotPasswordPage'
import ResetPasswordPage from './pages/ResetPasswordPage'

// User pages
import UserDashboard from './pages/UserDashboard'
import ChatPage from './pages/ChatPage'
import ChatHistoryPage from './pages/ChatHistoryPage'
import ChatDetailPage from './pages/ChatDetailPage'
import DocumentsBrowsePage from './pages/DocumentsBrowsePage'
import SettingsPage from './pages/SettingsPage'

// Admin pages
import AdminDashboard from './pages/AdminDashboard'
import AdminDocumentsPage from './pages/AdminDocumentsPage'
import AdminUploadPage from './pages/AdminUploadPage'
import AdminDocumentDetailPage from './pages/AdminDocumentDetailPage'
import AdminCollectionsPage from './pages/AdminCollectionsPage'
import AdminUsersPage from './pages/AdminUsersPage'
import AdminInviteUserPage from './pages/AdminInviteUserPage'
import AdminUserDetailPage from './pages/AdminUserDetailPage'
import AdminSettingsPage from './pages/AdminSettingsPage'
import AdminAnalyticsPage from './pages/AdminAnalyticsPage'
import AdminAuditLogPage from './pages/AdminAuditLogPage'

// Chat workspace selector
import ChatNewPage from './pages/ChatNewPage'

// Legacy workspace pages (keep for backward compat)
import WorkspacesPage from './pages/WorkspacesPage'
import WorkspaceDetailPage from './pages/WorkspaceDetailPage'
import InvestigationPage from './pages/InvestigationPage'
import ApiCatalogPage from './pages/ApiCatalogPage'

// ─── HOC helpers ────────────────────────────────────────────────────────────
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000, refetchOnWindowFocus: false },
  },
})

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth()
  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-bg">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-text-muted text-sm animate-pulse">Loading...</p>
        </div>
      </div>
    )
  }
  if (!isAuthenticated) return <Navigate to="/login" replace />
  return <>{children}</>
}

function AdminRoute({ children }: { children: ReactNode }) {
  const { user, isAuthenticated } = useAuth()
  if (!isAuthenticated) return <Navigate to="/login" replace />
  if (user?.role !== 'admin') {
    return (
      <div className="flex h-screen items-center justify-center bg-bg">
        <div className="mx-auto max-w-md text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-red-500/10">
            <svg className="h-8 w-8 text-red" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m0 0v2m0-2h2m-2 0H10m9.364-7.364A9 9 0 1112 3a9 9 0 017.364 4.636z" />
            </svg>
          </div>
          <h2 className="mb-2 text-xl font-bold text-text">Access Denied</h2>
          <p className="text-text-muted">You need admin privileges to access this page.</p>
        </div>
      </div>
    )
  }
  return <>{children}</>
}

// ─── App Routes ─────────────────────────────────────────────────────────────
function AppRoutes() {
  return (
    <Routes>
      {/* ── PUBLIC ──────────────────────────────────────────────────────── */}
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<RegisterPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />

      {/* ── USER (protected, with Layout) ────────────────────────────────── */}
      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route path="/dashboard" element={<UserDashboard />} />
        <Route path="/chat/new" element={<ChatNewPage />} />
        <Route path="/chats" element={<ChatHistoryPage />} />
        <Route path="/chat/:queryId" element={<ChatDetailPage />} />
        <Route path="/documents" element={<DocumentsBrowsePage />} />
        <Route path="/settings" element={<SettingsPage />} />

        {/* Legacy workspace routes */}
        <Route path="/workspaces" element={<WorkspacesPage />} />
        <Route path="/workspaces/:id" element={<WorkspaceDetailPage />} />
        <Route path="/workspaces/:id/chat" element={<ChatPage />} />
        <Route path="/workspaces/:id/investigate" element={<InvestigationPage />} />
      </Route>

      {/* ── ADMIN (protected) ────────────────────────────────────────────── */}
      <Route
        element={
          <AdminRoute>
            <Layout />
          </AdminRoute>
        }
      >
        <Route path="/api-catalog" element={<ApiCatalogPage />} />

        {/* Admin sub-layout */}
        <Route
          element={
            <AdminRoute>
              <AdminLayout />
            </AdminRoute>
          }
        >
          <Route path="/admin" element={<AdminDashboard />} />
          <Route path="/admin/documents" element={<AdminDocumentsPage />} />
          <Route path="/admin/documents/upload" element={<AdminUploadPage />} />
          <Route path="/admin/documents/:docId" element={<AdminDocumentDetailPage />} />
          <Route path="/admin/collections" element={<AdminCollectionsPage />} />
          <Route path="/admin/users" element={<AdminUsersPage />} />
          <Route path="/admin/users/invite" element={<AdminInviteUserPage />} />
          <Route path="/admin/users/:userId" element={<AdminUserDetailPage />} />
          <Route path="/admin/settings" element={<AdminSettingsPage />} />
          <Route path="/admin/analytics" element={<AdminAnalyticsPage />} />
          <Route path="/admin/audit-log" element={<AdminAuditLogPage />} />
        </Route>
      </Route>

      {/* ── FALLBACK ─────────────────────────────────────────────────────── */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ToastProvider>
          <AuthProvider>
            <AppRoutes />
          </AuthProvider>
        </ToastProvider>
      </BrowserRouter>
    </QueryClientProvider>
  )
}

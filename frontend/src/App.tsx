import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from './context/AuthContext';
import { ToastProvider, Skeleton } from './components/ui';
import Layout from './components/Layout'
import CursorGlow from './components/CursorGlow'
import { ProtectedRoute, AdminRoute } from './components/RouteGuards'

// Route-level code splitting — chunks load on demand
const LandingPage = lazy(() => import('./pages/LandingPage'))
const LoginPage = lazy(() => import('./pages/LoginPage'))
const RegisterPage = lazy(() => import('./pages/RegisterPage'))
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage'))
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage'))
const UserDashboard = lazy(() => import('./pages/UserDashboard'))
const ChatPage = lazy(() => import('./pages/ChatPage'))
const ChatHistoryPage = lazy(() => import('./pages/ChatHistoryPage'))
const ChatDetailPage = lazy(() => import('./pages/ChatDetailPage'))
const DocumentsBrowsePage = lazy(() => import('./pages/DocumentsBrowsePage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const AdminDashboard = lazy(() => import('./pages/AdminDashboard'))
const AdminDocumentsPage = lazy(() => import('./pages/AdminDocumentsPage'))
const AdminUploadPage = lazy(() => import('./pages/AdminUploadPage'))
const AdminDocumentDetailPage = lazy(() => import('./pages/AdminDocumentDetailPage'))
const AdminCollectionsPage = lazy(() => import('./pages/AdminCollectionsPage'))
const AdminUsersPage = lazy(() => import('./pages/AdminUsersPage'))
const AdminInviteUserPage = lazy(() => import('./pages/AdminInviteUserPage'))
const AdminUserDetailPage = lazy(() => import('./pages/AdminUserDetailPage'))
const AdminSettingsPage = lazy(() => import('./pages/AdminSettingsPage'))
const AdminAnalyticsPage = lazy(() => import('./pages/AdminAnalyticsPage'))
const AdminAuditLogPage = lazy(() => import('./pages/AdminAuditLogPage'))
const AdminPromptsPage = lazy(() => import('./pages/AdminPromptsPage'))
const AdminGoldenPage = lazy(() => import('./pages/AdminGoldenPage'))
const ChatNewPage = lazy(() => import('./pages/ChatNewPage'))
const WorkspacesPage = lazy(() => import('./pages/WorkspacesPage'))
const WorkspaceDetailPage = lazy(() => import('./pages/WorkspaceDetailPage'))
const WorkspaceDocumentDetailPage = lazy(() => import('./pages/WorkspaceDocumentDetailPage'))
const ReviewQueuePage = lazy(() => import('./pages/ReviewQueuePage'))
const InvestigationPage = lazy(() => import('./pages/InvestigationPage'))
const ApiCatalogPage = lazy(() => import('./pages/ApiCatalogPage'))
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'))
const PrivacyPage = lazy(() => import('./pages/PrivacyPage'))
const TermsPage = lazy(() => import('./pages/TermsPage'))
const ContactPage = lazy(() => import('./pages/ContactPage'))

// ─── HOC helpers ────────────────────────────────────────────────────────────
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000, refetchOnWindowFocus: false },
  },
})

// ─── App Routes ─────────────────────────────────────────────────────────────
function RouteFallback() {
  return (
    <div className="flex h-screen items-center justify-center bg-bg">
      <div className="flex flex-col items-center gap-4">
        <Skeleton height={24} width={160} />
        <Skeleton height={14} width={240} />
      </div>
    </div>
  )
}

function AppRoutes() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
      {/* ── PUBLIC ──────────────────────────────────────────────────────── */}
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<RegisterPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />

      {/* ── PROTECTED (with Layout) — user + admin pages ──────────────────── */}
      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        {/* User pages */}
        <Route path="/dashboard" element={<UserDashboard />} />
        <Route path="/workspace" element={<Navigate to="/workspaces" replace />} />
        <Route path="/chat" element={<Navigate to="/chat/new" replace />} />
        <Route path="/chat/new" element={<ChatNewPage />} />
        <Route path="/chats" element={<ChatHistoryPage />} />
        <Route path="/chat/:queryId" element={<ChatDetailPage />} />
        <Route path="/workspaces/:id/queries/:queryId" element={<ChatDetailPage />} />
        <Route path="/documents" element={<DocumentsBrowsePage />} />
        <Route path="/settings" element={<SettingsPage />} />

        {/* Workspace routes */}
        <Route path="/workspaces" element={<WorkspacesPage />} />
        <Route path="/workspaces/:id" element={<WorkspaceDetailPage />} />
        <Route path="/workspaces/:id/documents/:docId" element={<WorkspaceDocumentDetailPage />} />
        <Route path="/workspaces/:id/review-queue" element={<ReviewQueuePage />} />
        <Route path="/workspaces/:id/chat" element={<ChatPage />} />
        <Route path="/workspaces/:id/investigate" element={<InvestigationPage />} />

        {/* Admin pages */}
        <Route element={<AdminRoute />}>
          <Route path="/api-catalog" element={<ApiCatalogPage />} />
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
          <Route path="/admin/prompts" element={<AdminPromptsPage />} />
          <Route path="/admin/golden" element={<AdminGoldenPage />} />
        </Route>
      </Route>

      {/* ── STATIC PAGES ────────────────────────────────────────────────── */}
      <Route path="/privacy" element={<PrivacyPage />} />
      <Route path="/terms" element={<TermsPage />} />
      <Route path="/contact" element={<ContactPage />} />

      {/* ── FALLBACK ─────────────────────────────────────────────────────── */}
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
    </Suspense>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ToastProvider>
          <AuthProvider>
            <AppRoutes />
            <CursorGlow />
            <div className="noise-overlay" aria-hidden="true" />
          </AuthProvider>
        </ToastProvider>
      </BrowserRouter>
    </QueryClientProvider>
  )
}

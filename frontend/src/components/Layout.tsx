import { useEffect, useRef, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import {
  BarChart3,
  BookOpen,
  ClipboardList,
  FileText,
  FolderOpen,
  GitBranch,
  History,
  Inbox,
  Layers,
  LayoutGrid,
  LogOut,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings,
  Shield,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Upload,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '../context/auth-context';
import { useTheme } from '../context/theme-context';
import Logo from './Logo';
import GlobalSearch from './GlobalSearch';
import { FOCUSABLE_SELECTOR } from './ui';
import { queryApi, reviewQueueApi, workspaceApi } from '../api/client';
import { SourceViewerProvider } from '../context/SourceViewerContext';
import { DemoTourWarmup, DemoTourButton } from './DemoTour';

// Icon-button geometry (the prototype's .icon-btn): 40px, 44px below lg where
// the shell is touch-first. No display or hover colour here — call sites add
// those, so a responsive `hidden` / `inline-flex` never fights a base class.
const ICON_BTN =
  'h-10 w-10 shrink-0 items-center justify-center rounded-control text-text-muted transition-colors duration-150 max-lg:h-11 max-lg:w-11';

// ─── Theme toggle ─────────────────────────────────────────────────────────────
/**
 * Header light/dark switch. The icon shows the mode you are switching *to*
 * (sun while dark is active, moon while light is active), and the accessible
 * name states the action rather than the state — so it deliberately does NOT
 * also carry `aria-pressed`, which would conflict with that naming.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';
  const label = isDark ? 'Switch to light mode' : 'Switch to dark mode';

  return (
    <button
      type="button"
      onClick={toggleTheme}
      title={label}
      aria-label={label}
      className={clsx(ICON_BTN, 'inline-flex hover:bg-card-2 hover:text-text', className)}
    >
      {isDark
        ? <Sun size={18} strokeWidth={1.75} aria-hidden="true" />
        : <Moon size={18} strokeWidth={1.75} aria-hidden="true" />}
    </button>
  );
}

// ─── Navigation ───────────────────────────────────────────────────────────────
type NavIcon = typeof LayoutGrid;

interface NavItem {
  label: string;
  /** Undefined = unavailable on this page; rendered disabled with `disabledReason`. */
  path?: string;
  icon: NavIcon;
  badge?: number;
  disabledReason?: string;
}

const ADMIN_NAV: NavItem[] = [
  { label: 'Admin Dashboard', path: '/admin', icon: Shield },
  { label: 'Documents', path: '/admin/documents', icon: FileText },
  { label: 'Upload', path: '/admin/documents/upload', icon: Upload },
  { label: 'Users', path: '/admin/users', icon: Users },
  { label: 'Analytics', path: '/admin/analytics', icon: BarChart3 },
  { label: 'Settings', path: '/admin/settings', icon: Settings },
  { label: 'Audit Log', path: '/admin/audit-log', icon: ClipboardList },
  { label: 'Prompts', path: '/admin/prompts', icon: GitBranch },
  { label: 'Golden Set', path: '/admin/golden', icon: Sparkles },
  { label: 'Collections', path: '/admin/collections', icon: FolderOpen },
  { label: 'API Catalog', path: '/api-catalog', icon: BookOpen },
];

/** The nav path that owns `pathname`: an exact match, else the longest `path/` prefix. */
function currentNavPath(pathname: string, paths: string[]): string | undefined {
  return paths
    .filter((path) => pathname === path || pathname.startsWith(`${path}/`))
    .sort((a, b) => b.length - a.length)[0];
}

/** "Northwind Renewables — Due Diligence" → "NR"; "demo_analyst" → "DA". */
function initials(name: string): string {
  return name
    .split(/[\s_.-]+/)
    .filter((word) => /^[a-z0-9]/i.test(word))
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join('');
}

// The sidebar is an icon rail (64px) between lg and xl, and at xl+ when the
// user collapses it. Labels stay in the DOM as sr-only text, so every rail
// link keeps its accessible name. Literal strings so Tailwind can see them.
interface RailClasses {
  label: string;
  hide: string;
  center: string;
  stack: string;
  push: string;
}
const RAIL_WHEN_COLLAPSED: RailClasses = {
  label: 'lg:sr-only',
  hide: 'lg:hidden',
  center: 'lg:justify-center lg:px-0',
  stack: 'lg:flex-col',
  push: 'lg:ml-0',
};
const RAIL_BELOW_XL: RailClasses = {
  label: 'lg:max-xl:sr-only',
  hide: 'lg:max-xl:hidden',
  center: 'lg:max-xl:justify-center lg:max-xl:px-0',
  stack: 'lg:max-xl:flex-col',
  push: 'lg:max-xl:ml-0',
};

const NAV_ROW =
  'flex min-h-10 items-center gap-3 rounded-control px-3 text-sm font-medium transition-colors duration-150 max-lg:min-h-11';

function SideNavList({
  items,
  current,
  pathname,
  rail,
  onNavigate,
  labelledBy,
}: {
  items: NavItem[];
  current: string | undefined;
  pathname: string;
  rail: RailClasses;
  onNavigate: () => void;
  labelledBy?: string;
}) {
  return (
    <ul className="flex flex-col gap-0.5" aria-labelledby={labelledBy}>
      {items.map((item) => {
        const Icon = item.icon;
        if (!item.path) {
          return (
            <li key={item.label}>
              <span
                aria-disabled="true"
                title={item.disabledReason}
                className={clsx(NAV_ROW, rail.center, 'cursor-not-allowed text-text-dim')}
              >
                <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
                <span className={rail.label}>{item.label}</span>
              </span>
            </li>
          );
        }
        const isCurrent = item.path === current;
        // aria-current: `page` on the exact page, `true` on the section a deeper page sits in.
        return (
          <li key={item.path}>
            <Link
              to={item.path}
              onClick={onNavigate}
              title={item.label}
              aria-current={isCurrent ? (pathname === item.path ? 'page' : 'true') : undefined}
              className={clsx(
                NAV_ROW,
                rail.center,
                isCurrent ? 'bg-primary-tint text-text' : 'text-text-muted hover:bg-card-2 hover:text-text',
              )}
            >
              <Icon size={18} strokeWidth={1.75} aria-hidden="true" className={isCurrent ? 'text-primary' : undefined} />
              <span className={rail.label}>{item.label}</span>
              {item.badge ? (
                <span className={clsx('ml-auto rounded-full bg-red/10 px-1.5 text-[11px] font-semibold leading-5 text-red', rail.hide)}>
                  {item.badge}
                  <span className="sr-only"> to review</span>
                </span>
              ) : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

// ─── Shell ────────────────────────────────────────────────────────────────────
/**
 * One top bar (menu, TruthLens mark, workspace breadcrumb, search, theme) over
 * a sidebar (New chat, nav, Recent, account) and the routed page. The sidebar
 * is a drawer below lg, an icon rail from lg to xl, and full width from xl.
 */
// BUG-49: the sidebar's collapsed/expanded state didn't survive a reload.
// Mirrors the theme-context localStorage pattern (try/catch — never let a
// storage read/write take the shell down).
const SIDEBAR_COLLAPSED_KEY = 'truthlens:sidebar-collapsed';

function getStoredCollapsed(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';
  } catch {
    return false;
  }
}

export default function Layout() {
  const { user, isAuthenticated, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(getStoredCollapsed);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const workspaceId = pathname.match(/^\/workspaces\/([^/]+)/)?.[1];

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
    } catch {
      // Storage unavailable — the choice still applies for this session.
    }
  }, [collapsed]);

  // Same key + fetcher as WorkspaceDetailPage, so both share one cache entry.
  const { data: workspace, isError: workspaceFailed } = useQuery({
    queryKey: ['workspace', workspaceId],
    queryFn: () => workspaceApi.get(workspaceId as string),
    enabled: isAuthenticated && Boolean(workspaceId),
  });

  const { data: reviewCount = 0 } = useQuery({
    queryKey: ['review-queue', workspaceId, 'count'],
    queryFn: () => reviewQueueApi.count(workspaceId as string).then((response) => response.count),
    enabled: isAuthenticated && Boolean(workspaceId),
  });

  // Keyed on the route, so a chat asked on one page is listed after the next
  // navigation; the previous list stays on screen while the new one loads.
  //
  // BUG-59 / C3: "Recent" implies *your* chats, but for an admin `/api/queries`
  // returns every workspace member's queries. `mine=true` (C3) scopes it to
  // the signed-in user. `client.ts`'s `QueryListParams` doesn't declare `mine`
  // yet (client.ts is scaffold-owned outside its auth-refresh logic) — the
  // cast is the documented workaround, not a slip.
  const { data: recentChats } = useQuery({
    queryKey: ['queries', 'recent', 'mine', pathname],
    queryFn: () =>
      queryApi
        .listAll({ page_size: 6, mine: true } as Parameters<typeof queryApi.listAll>[0] & { mine: boolean })
        .then((response) => response.data),
    enabled: isAuthenticated,
    placeholderData: keepPreviousData,
  });

  // Esc closes the mobile drawer and hands focus back to its toggle.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setDrawerOpen(false);
      menuButtonRef.current?.focus();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [drawerOpen]);

  // BUG-61: the mobile drawer didn't trap focus, so Tab walked straight into
  // the header behind the scrim. Same pattern as Modal's trap in ui.tsx —
  // move focus in on open, wrap Tab/Shift+Tab within the drawer's own
  // focusable elements while it's open.
  useEffect(() => {
    if (!drawerOpen) return;
    const drawer = drawerRef.current;
    const raf = requestAnimationFrame(() => {
      const focusable = drawer?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      (focusable && focusable.length > 0 ? focusable[0] : drawer)?.focus();
    });
    const handleTab = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !drawer) return;
      const focusable = Array.from(drawer.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey) {
        if (active === first || !drawer.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last || !drawer.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleTab);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', handleTab);
    };
  }, [drawerOpen]);

  if (!isAuthenticated) return <Outlet />;

  const closeDrawer = () => setDrawerOpen(false);
  const signOut = () => {
    void logout();
    navigate('/login');
  };
  const isAdmin = user?.role === 'admin';
  const rail = collapsed ? RAIL_WHEN_COLLAPSED : RAIL_BELOW_XL;

  const mainNav: NavItem[] = [
    { label: 'Dashboard', path: '/dashboard', icon: LayoutGrid },
    { label: 'Chat History', path: '/chats', icon: History },
    { label: 'My Documents', path: '/documents', icon: FileText },
    { label: 'Workspaces', path: '/workspaces', icon: Layers },
    {
      label: 'Review Queue',
      path: workspaceId ? `/workspaces/${workspaceId}/review-queue` : undefined,
      icon: Inbox,
      badge: reviewCount,
      disabledReason: 'Open a workspace to see its review queue',
    },
    { label: 'Settings', path: '/settings', icon: SlidersHorizontal },
  ];
  const current = currentNavPath(
    pathname,
    [...mainNav, ...(isAdmin ? ADMIN_NAV : [])].flatMap((item) => (item.path ? [item.path] : [])),
  );
  const newChatPath = workspaceId ? `/workspaces/${workspaceId}/chat` : '/chat/new';
  const roleLabel = user?.role ? user.role.charAt(0).toUpperCase() + user.role.slice(1) : '';

  return (
    <SourceViewerProvider>
    <DemoTourWarmup />
    <div className="flex h-dvh flex-col overflow-hidden bg-bg">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-[70] focus:rounded-control focus:bg-primary focus:px-3.5 focus:py-2.5 focus:text-sm focus:font-medium focus:text-on-primary"
      >
        Skip to content
      </a>

      {/* ─── Top bar — the only header row ─────────────────────────────── */}
      <header className="relative z-40 flex h-14 shrink-0 items-center gap-1 border-b border-border bg-solid px-2 sm:gap-2 sm:px-3">
        <button
          ref={menuButtonRef}
          type="button"
          onClick={() => setDrawerOpen((open) => !open)}
          aria-controls="app-sidebar"
          aria-expanded={drawerOpen}
          aria-label={drawerOpen ? 'Close navigation menu' : 'Open navigation menu'}
          className={clsx(ICON_BTN, 'inline-flex hover:bg-card-2 hover:text-text lg:hidden')}
        >
          {drawerOpen
            ? <X size={20} strokeWidth={1.75} aria-hidden="true" />
            : <Menu size={20} strokeWidth={1.75} aria-hidden="true" />}
        </button>
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          aria-controls="app-sidebar"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={clsx(ICON_BTN, 'hidden hover:bg-card-2 hover:text-text xl:inline-flex')}
        >
          {collapsed
            ? <PanelLeftOpen size={18} strokeWidth={1.75} aria-hidden="true" />
            : <PanelLeftClose size={18} strokeWidth={1.75} aria-hidden="true" />}
        </button>

        <Link
          to="/dashboard"
          aria-label="TruthLens home"
          className="flex min-h-11 shrink-0 items-center gap-2 rounded-control px-1.5 text-text transition-colors hover:bg-card-2"
        >
          <Logo size={24} className="text-primary" />
          <span className={clsx('text-[17px] font-semibold tracking-[-0.01em]', workspaceId && 'max-sm:hidden')}>
            TruthLens
          </span>
        </Link>

        {workspaceId && (
          <>
            <span aria-hidden="true" className="text-text-dim max-sm:hidden">/</span>
            <Link
              to={`/workspaces/${workspaceId}`}
              title={workspace?.name}
              className="flex min-h-11 min-w-0 items-center gap-2.5 rounded-control px-1.5 transition-colors hover:bg-card-2"
            >
              {workspace ? (
                <>
                  <span
                    aria-hidden="true"
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-text font-cond text-xs font-semibold tracking-[0.03em] text-bg max-sm:hidden"
                  >
                    {initials(workspace.name)}
                  </span>
                  <span className="flex min-w-0 items-baseline gap-2.5">
                    <span className="truncate text-[15px] font-semibold text-text">{workspace.name}</span>
                    <span className="shrink-0 whitespace-nowrap text-[13px] text-text-dim max-sm:hidden">
                      {workspace.document_count} {workspace.document_count === 1 ? 'document' : 'documents'}
                    </span>
                  </span>
                </>
              ) : workspaceFailed ? (
                <span className="truncate text-[15px] font-semibold text-text">Workspace</span>
              ) : (
                <>
                  <span aria-hidden="true" className="shimmer block h-4 w-36 rounded-chip" />
                  <span className="sr-only">Loading workspace</span>
                </>
              )}
            </Link>
          </>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          {/* R2-2: the presenter tour trigger lives in the top bar itself,
              not as a viewport-fixed pill, so it can never sit on top of a
              page's own header action buttons. */}
          <DemoTourButton />
          <GlobalSearch />
          <ThemeToggle />
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        {drawerOpen && (
          <div className="fixed inset-x-0 bottom-0 top-14 z-40 bg-scrim lg:hidden" onClick={closeDrawer} aria-hidden="true" />
        )}

        {/* ─── Sidebar ─────────────────────────────────────────────────── */}
        <nav
          ref={drawerRef}
          id="app-sidebar"
          aria-label="Primary"
          tabIndex={-1}
          className={clsx(
            // Below lg: a drawer under the top bar (hidden from AT while closed).
            'fixed bottom-0 left-0 top-14 z-50 flex w-[min(300px,86vw)] flex-col gap-0.5 overflow-y-auto border-r border-border bg-solid p-3 shadow-e3 transition-transform duration-200 ease-out',
            drawerOpen ? 'translate-x-0' : '-translate-x-full max-lg:invisible',
            // lg+: an in-flow column, rail-width until xl.
            'lg:static lg:z-auto lg:w-16 lg:translate-x-0 lg:shadow-none',
            !collapsed && 'xl:w-[248px]',
          )}
        >
          <Link
            to={newChatPath}
            onClick={closeDrawer}
            title="New chat"
            className={clsx(NAV_ROW, rail.center, 'mb-2.5 border border-border-strong text-text hover:bg-card-2')}
          >
            <Plus size={18} strokeWidth={1.75} aria-hidden="true" />
            <span className={rail.label}>New chat</span>
          </Link>

          <SideNavList items={mainNav} current={current} pathname={pathname} rail={rail} onNavigate={closeDrawer} />

          {isAdmin && (
            <div className="mt-3 border-t border-border pt-3">
              <p id="nav-admin-heading" className={clsx('px-3 pb-1.5 text-xs text-text-dim', rail.hide)}>Admin</p>
              <SideNavList
                items={ADMIN_NAV}
                current={current}
                pathname={pathname}
                rail={rail}
                onNavigate={closeDrawer}
                labelledBy="nav-admin-heading"
              />
            </div>
          )}

          <div className={clsx('mt-5', rail.hide)}>
            <p id="nav-recent-heading" className="px-3 pb-1.5 text-xs text-text-dim">Recent</p>
            {recentChats && recentChats.length > 0 ? (
              <ul aria-labelledby="nav-recent-heading">
                {recentChats.map((chat) => {
                  const to = `/workspaces/${chat.workspace_id}/queries/${chat.id}`;
                  const isCurrent = pathname === to;
                  return (
                    <li key={chat.id}>
                      <Link
                        to={to}
                        onClick={closeDrawer}
                        title={chat.query_text}
                        aria-current={isCurrent ? 'page' : undefined}
                        className={clsx(
                          'block truncate rounded-control px-3 py-2 text-sm leading-5 transition-colors duration-150 max-lg:py-3',
                          isCurrent ? 'bg-card-2 font-medium text-text' : 'text-text-muted hover:bg-card-2 hover:text-text',
                        )}
                      >
                        {chat.query_text}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : recentChats ? (
              <p className="px-3 text-[13px] text-text-dim">No chats yet.</p>
            ) : null}
          </div>

          {user && (
            <div className={clsx('mt-auto flex items-center gap-2.5 border-t border-border pt-2.5', rail.stack)}>
              <span
                aria-hidden="true"
                title={user.username}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary-tint text-xs font-semibold text-primary"
              >
                {initials(user.username) || '?'}
              </span>
              <span className={clsx('flex min-w-0 flex-col', rail.hide)}>
                <span className="truncate text-sm font-medium leading-[18px] text-text">{user.username}</span>
                <span className="truncate text-xs leading-4 text-text-dim">{roleLabel}</span>
              </span>
              <button
                type="button"
                onClick={signOut}
                aria-label="Sign out"
                title="Sign out"
                className={clsx(ICON_BTN, 'ml-auto inline-flex hover:bg-red/10 hover:text-red', rail.push)}
              >
                <LogOut size={18} strokeWidth={1.75} aria-hidden="true" />
              </button>
            </div>
          )}
        </nav>

        {/* ─── Page ────────────────────────────────────────────────────── */}
        <main id="main-content" tabIndex={-1} className="relative min-w-0 flex-1 overflow-y-auto p-4 focus:outline-none lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
    </SourceViewerProvider>
  );
}

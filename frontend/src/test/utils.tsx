import type { ReactElement, ReactNode } from 'react';
import { render, type RenderOptions } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthContext, type AuthContextValue } from '../context/auth-context';
import { ToastContext, type ToastContextValue } from '../components/toast-context';

const defaultAuthValue: AuthContextValue = {
  user: null,
  isAuthenticated: false,
  isLoading: false,
  login: vi.fn(),
  register: vi.fn(),
  logout: vi.fn(),
};

const defaultToastValue: ToastContextValue = {
  addToast: vi.fn(),
  removeToast: vi.fn(),
};

/** Fresh QueryClient per test — retries/caching off so failures surface immediately. */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

interface RenderWithProvidersOptions extends Omit<RenderOptions, 'wrapper'> {
  /** Initial MemoryRouter location. Wrap `ui` in its own <Routes> if the
   * component under test reads route params via useParams(). */
  route?: string;
  authValue?: Partial<AuthContextValue>;
  toastValue?: Partial<ToastContextValue>;
  queryClient?: QueryClient;
}

export function renderWithProviders(
  ui: ReactElement,
  {
    route = '/',
    authValue,
    toastValue,
    queryClient = createTestQueryClient(),
    ...renderOptions
  }: RenderWithProvidersOptions = {},
) {
  const resolvedAuthValue: AuthContextValue = { ...defaultAuthValue, ...authValue };
  const resolvedToastValue: ToastContextValue = { ...defaultToastValue, ...toastValue };

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[route]}>
          <ToastContext.Provider value={resolvedToastValue}>
            <AuthContext.Provider value={resolvedAuthValue}>
              {children}
            </AuthContext.Provider>
          </ToastContext.Provider>
        </MemoryRouter>
      </QueryClientProvider>
    );
  }

  return {
    ...render(ui, { wrapper: Wrapper, ...renderOptions }),
    queryClient,
  };
}

export * from '@testing-library/react';

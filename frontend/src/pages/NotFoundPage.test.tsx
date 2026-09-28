import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../test/utils';
import NotFoundPage from './NotFoundPage';

describe('NotFoundPage', () => {
  it('reads correctly instead of the dropped word (BUG-46)', () => {
    renderWithProviders(<NotFoundPage />);

    expect(screen.getByText(/use one of the links below/i)).toBeInTheDocument();
    expect(screen.queryByText(/use one links below/i)).not.toBeInTheDocument();
  });

  it('renders the CTAs as plain links, not <a><button> nesting', () => {
    renderWithProviders(<NotFoundPage />);

    const home = screen.getByRole('link', { name: /go home/i });
    const signIn = screen.getByRole('link', { name: /sign in/i });
    expect(home.tagName).toBe('A');
    expect(signIn.tagName).toBe('A');
    expect(home.querySelector('button')).toBeNull();
    expect(signIn.querySelector('button')).toBeNull();
  });
});

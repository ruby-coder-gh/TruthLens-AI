import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Tabs } from './ui';

// R3-9: at 375px, a workspace with every tab (Documents/Members/Radar/
// Activity…) is wider than the viewport — with no overflow boundary of its
// own, the tab bar's overflow used to bubble up into the whole *page*,
// making the route scroll 185px sideways. The tablist itself must own the
// horizontal scroll instead.
describe('Tabs (R3-9)', () => {
  const tabs = [
    { id: 'documents', label: 'Documents' },
    { id: 'members', label: 'Members' },
    { id: 'radar', label: 'Contradiction Radar' },
    { id: 'activity', label: 'Activity' },
  ];

  it('caps its own width and scrolls internally instead of growing past its container', () => {
    render(<Tabs tabs={tabs} activeTab="documents" onChange={vi.fn()} />);
    const tablist = screen.getByRole('tablist');
    expect(tablist.className).toContain('max-w-full');
    expect(tablist.className).toContain('overflow-x-auto');
  });

  it('keeps every tab reachable inside the scrollable bar', () => {
    render(<Tabs tabs={tabs} activeTab="documents" onChange={vi.fn()} />);
    for (const tab of tabs) {
      expect(screen.getByRole('tab', { name: tab.label })).toBeInTheDocument();
    }
  });
});

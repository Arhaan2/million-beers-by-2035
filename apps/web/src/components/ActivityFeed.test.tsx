import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { BeerEntry } from '../lib/types';
import { ActivityFeed } from './ActivityFeed';
import { Leaderboard } from './Leaderboard';

const groupEntry: BeerEntry = {
  id: 'group-entry',
  totalAmount: 12,
  note: 'Friday night hangout',
  createdAt: Date.now(),
  localDay: '2026-07-30',
  isCorrection: false,
  isGroup: true,
  allocations: [
    { id: 'a', contributor: 'Arhaan', amount: 4 },
    { id: 'b', contributor: 'Sam', amount: 3 },
    { id: 'c', contributor: 'Alex', amount: 3 },
    { id: 'd', contributor: 'Rohan', amount: 2 },
  ],
};

describe('ActivityFeed', () => {
  it('renders one group card and expands its allocation details accessibly', async () => {
    const user = userEvent.setup();
    render(<ActivityFeed entries={[groupEntry]} timezone="America/Los_Angeles" />);
    expect(screen.getByText('4 people')).toBeInTheDocument();
    expect(screen.getByText('Friday night hangout')).toBeInTheDocument();
    const disclosure = screen.getByRole('button', { name: 'Show allocations' });
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Arhaan')).not.toBeInTheDocument();
    await user.click(disclosure);
    expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Arhaan')).toBeInTheDocument();
    expect(screen.getByText('+4')).toBeInTheDocument();
  });

  it('renders corrections with negative per-person allocations and a reason', async () => {
    const user = userEvent.setup();
    render(
      <ActivityFeed
        timezone="America/Los_Angeles"
        entries={[
          {
            ...groupEntry,
            id: 'correction-entry',
            totalAmount: -6,
            note: 'Correcting duplicate round',
            isCorrection: true,
            allocations: [
              { id: 'ca', contributor: 'Arhaan', amount: -3 },
              { id: 'cb', contributor: 'Sam', amount: -3 },
            ],
          },
        ]}
      />,
    );
    expect(screen.getByText('Correction')).toBeInTheDocument();
    expect(screen.getByText('Correcting duplicate round')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show allocations' }));
    expect(screen.getAllByText('−3')).toHaveLength(2);
  });

  it('keeps a single-person entry compact', () => {
    render(
      <ActivityFeed
        timezone="America/Los_Angeles"
        entries={[
          {
            id: 'single-entry',
            totalAmount: 3,
            note: 'Single round',
            createdAt: Date.now(),
            localDay: '2026-07-30',
            isCorrection: false,
            isGroup: false,
            allocations: [{ id: 'single-allocation', contributor: 'Arhaan', amount: 3 }],
          },
        ]}
      />,
    );
    expect(screen.getByText('Arhaan')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /allocations/u })).not.toBeInTheDocument();
  });
});

describe('Leaderboard', () => {
  it('renders independently allocated group totals', () => {
    render(
      <Leaderboard
        entries={[
          { contributor: 'Arhaan', netTotal: 4, eventCount: 1 },
          { contributor: 'Sam', netTotal: 3, eventCount: 1 },
        ]}
      />,
    );
    expect(screen.getByText('Arhaan')).toBeInTheDocument();
    expect(screen.getByText('Sam')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });
});

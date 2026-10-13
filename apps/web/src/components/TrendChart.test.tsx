import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TrendChart } from './TrendChart';

describe('TrendChart', () => {
  it('explains the empty window instead of drawing a misleading chart', () => {
    render(<TrendChart days={[{ localDay: '2026-10-13', netTotal: 0, eventCount: 0 }]} />);
    expect(screen.getByText('A quiet stretch on the board')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('exposes every date and net value in an accessible daily breakdown', () => {
    render(
      <TrendChart
        days={[
          { localDay: '2026-10-12', netTotal: 6, eventCount: 2 },
          { localDay: '2026-10-13', netTotal: -2, eventCount: 1 },
        ]}
      />,
    );
    expect(screen.getByRole('img')).toHaveAccessibleName(
      /Daily net beer activity.*Oct 12, 2026 to Oct 13, 2026/u,
    );
    const disclosure = screen.getByText('View daily totals');
    expect(disclosure.closest('details')).not.toHaveAttribute('open');
    fireEvent.click(disclosure);
    const table = screen.getByRole('table', { name: 'Beer activity by recorded date' });
    expect(within(table).getByRole('row', { name: 'Oct 12, 2026 +6 2' })).toBeInTheDocument();
    expect(within(table).getByRole('row', { name: 'Oct 13, 2026 -2 1' })).toBeInTheDocument();
  });

  it('keeps the graph available for records whose additions and corrections net to zero', () => {
    render(<TrendChart days={[{ localDay: '2026-10-13', netTotal: 0, eventCount: 2 }]} />);
    expect(screen.getByRole('img')).toBeInTheDocument();
    expect(screen.getByText('1 day with records')).toBeInTheDocument();
  });
});

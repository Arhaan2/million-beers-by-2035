import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShareActions, type ShareCardData } from './ShareActions';

const data: ShareCardData = {
  title: 'Friday with the crew',
  subtitle: 'A saved memory',
  lines: ['6 beers recorded'],
  names: ['Sam'],
  url: 'https://example.com/#/entry/friday',
};

afterEach(() => vi.unstubAllGlobals());

describe('ShareActions', () => {
  it('announces a pending copy, prevents duplicate copies, and confirms completion', async () => {
    let finishCopy: (() => void) | undefined;
    const writeText = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishCopy = resolve;
        }),
    );
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    render(<ShareActions data={data} />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(screen.getByRole('button', { name: 'Copying…' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Copying link…');
    expect(writeText).toHaveBeenCalledExactlyOnceWith(data.url);
    await act(async () => {
      finishCopy?.();
      await Promise.resolve();
    });
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeEnabled();
    expect(screen.getByRole('status')).toHaveTextContent('Link copied.');
  });

  it('focuses and selects the public link when copying is unavailable', async () => {
    vi.stubGlobal('navigator', {});
    render(<ShareActions data={data} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    const field = await screen.findByRole('textbox', { name: 'Public link' });
    expect(field).toHaveFocus();
    expect(field).toHaveValue(data.url);
    expect((field as HTMLInputElement).selectionStart).toBe(0);
    expect((field as HTMLInputElement).selectionEnd).toBe(data.url.length);
    expect(screen.getByRole('status')).toHaveTextContent('Copy the selected link below.');
  });

  it('treats canceled native sharing as a cancellation and keeps the action available', async () => {
    vi.stubGlobal('navigator', {
      share: vi.fn().mockRejectedValue(new DOMException('Canceled', 'AbortError')),
    });
    render(<ShareActions data={data} />);
    fireEvent.click(screen.getByRole('button', { name: 'Share…' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Sharing canceled.'));
    expect(screen.getByRole('button', { name: 'Share…' })).toBeEnabled();
    expect(screen.queryByRole('textbox', { name: 'Public link' })).not.toBeInTheDocument();
  });
});

it('shares the prepared PNG when file sharing is supported and preserves cancellation', async () => {
  const context = {
    fillRect: vi.fn(),
    fillText: vi.fn(),
    measureText: (text: string) => ({ width: text.length * 10 }),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    context as unknown as CanvasRenderingContext2D,
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) =>
    callback(new Blob(['PNG'], { type: 'image/png' })),
  );
  const share = vi.fn().mockRejectedValue(new DOMException('Canceled', 'AbortError'));
  const canShare = vi.fn().mockReturnValue(true);
  vi.stubGlobal('navigator', { share, canShare });
  render(<ShareActions data={data} />);
  fireEvent.click(screen.getByRole('button', { name: 'Share…' }));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Image ready.'));
  expect(share).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Share…' }));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Sharing canceled.'));
  expect(share.mock.calls[0][0].files[0]).toBeInstanceOf(File);
  expect(share.mock.calls[0][0].files[0].type).toBe('image/png');
  expect(share.mock.calls[0][0]).not.toHaveProperty('url');
  vi.restoreAllMocks();
});

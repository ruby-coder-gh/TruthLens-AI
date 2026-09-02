import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { downloadBlob } from './download';

describe('downloadBlob', () => {
  let createObjectURLSpy: ReturnType<typeof vi.spyOn>;
  let revokeObjectURLSpy: ReturnType<typeof vi.spyOn>;
  let clickSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
    revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates an object URL for the given blob and revokes it after use', () => {
    const blob = new Blob(['hello'], { type: 'text/csv' });

    downloadBlob(blob, 'report.csv');

    expect(createObjectURLSpy).toHaveBeenCalledWith(blob);
    expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:mock-url');
  });

  it('clicks a temporary anchor with the download attribute set to the filename', () => {
    const createElementSpy = vi.spyOn(document, 'createElement');

    downloadBlob(new Blob(['x']), 'audit-log-2026-09-02.csv');

    const anchor = createElementSpy.mock.results[0]?.value as HTMLAnchorElement;
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(anchor.download).toBe('audit-log-2026-09-02.csv');
    expect(anchor.href).toBe('blob:mock-url');
  });

  it('removes the anchor from the document after the click', () => {
    const appendSpy = vi.spyOn(document.body, 'appendChild');

    downloadBlob(new Blob(['x']), 'file.json');

    const anchor = appendSpy.mock.results[0]?.value as HTMLAnchorElement;
    expect(document.body.contains(anchor)).toBe(false);
  });

  it('revokes the object URL after clicking, not before', () => {
    const callOrder: string[] = [];
    clickSpy.mockImplementation(() => { callOrder.push('click'); });
    revokeObjectURLSpy.mockImplementation(() => { callOrder.push('revoke'); });

    downloadBlob(new Blob(['x']), 'file.txt');

    expect(callOrder).toEqual(['click', 'revoke']);
  });
});

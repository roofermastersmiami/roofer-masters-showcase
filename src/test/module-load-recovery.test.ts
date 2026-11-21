import { describe, expect, it, vi } from 'vitest';
import { claimModuleReload, installModuleLoadRecovery, isModuleLoadError } from '@/lib/module-load-recovery';

describe('module download recovery', () => {
  it('recognizes Safari and Chromium module failures, but not ordinary request failures', () => {
    expect(isModuleLoadError(new TypeError('Importing a module script failed.'))).toBe(true);
    expect(isModuleLoadError(new TypeError('Failed to fetch dynamically imported module: /assets/roof.js'))).toBe(true);
    expect(isModuleLoadError(new TypeError('Load failed'))).toBe(false);
  });
  it('allows one refresh, not an automatic reload loop', () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    expect(claimModuleReload(storage, 100_000)).toBe(true);
    expect(claimModuleReload(storage, 100_001)).toBe(false);
    expect(claimModuleReload(storage, 160_000)).toBe(true);
  });
  it('does not auto-refresh when browser storage is blocked', () => {
    expect(claimModuleReload({ getItem: () => { throw new Error('blocked'); }, setItem: vi.fn() }, 100_000)).toBe(false);
  });
  it('handles preload failures and unregisters its listener', () => {
    const target = new EventTarget();
    const reload = vi.fn();
    const storage = new Map<string, string>();
    Object.assign(target, { sessionStorage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v) }, location: { reload } });
    const dispose = installModuleLoadRecovery(target as Window);
    const event = new Event('vite:preloadError', { cancelable: true });
    target.dispatchEvent(event);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
    target.dispatchEvent(new Event('vite:preloadError'));
    expect(reload).toHaveBeenCalledTimes(1);
    dispose();
    storage.clear();
    target.dispatchEvent(new Event('vite:preloadError'));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
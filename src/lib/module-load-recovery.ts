const RELOAD_KEY = 'rm-module-reload-at';
const RELOAD_COOLDOWN_MS = 60_000;

export function isModuleLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /importing a module script failed|failed to fetch dynamically imported module|error loading dynamically imported module|loading chunk .+ failed|unable to preload css/i.test(message);
}

export function claimModuleReload(storage: Pick<Storage, 'getItem' | 'setItem'>, now: number): boolean {
  try {
    const previous = Number(storage.getItem(RELOAD_KEY));
    if (previous > 0 && now - previous < RELOAD_COOLDOWN_MS) return false;
    storage.setItem(RELOAD_KEY, String(now));
    return true;
  } catch {
    // Without storage, automatic refresh cannot be bounded safely.
    return false;
  }
}

export function installModuleLoadRecovery(target: Window): () => void {
  const recover = (event: Event) => {
    // Vite emits this event for stale or interrupted module/CSS downloads.
    // Do not refresh for ordinary failed API requests or application errors.
    try {
      if (!claimModuleReload(target.sessionStorage, Date.now())) return;
      event.preventDefault();
      target.location.reload();
    } catch {
      // Leave the normal error boundary available when storage is disabled.
    }
  };
  target.addEventListener('vite:preloadError', recover);
  return () => target.removeEventListener('vite:preloadError', recover);
}
export type ThemeMode = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'schhol-theme';

const hasWindow = () =>
  typeof window !== 'undefined' && typeof document !== 'undefined';

const systemPreference = () => {
  if (!hasWindow() || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
};

export function getThemeMode(): ThemeMode {
  if (!hasWindow()) return 'system';
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      return stored;
    }
  } catch {
    // Storage can be unavailable in private browsing; fall back to system.
  }
  return 'system';
}

export function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'system') return systemPreference() ? 'dark' : 'light';
  return mode;
}

export function applyThemeMode(mode: ThemeMode) {
  if (!hasWindow()) return;
  const resolved = resolveTheme(mode);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themeMode = mode;
  document.documentElement.style.colorScheme = resolved;
}

export function setThemeMode(mode: ThemeMode) {
  if (hasWindow()) {
    try {
      window.localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // Ignore storage failures; the visual change still applies.
    }
  }
  applyThemeMode(mode);
}

export function initThemeMode() {
  applyThemeMode(getThemeMode());
  if (!hasWindow() || typeof window.matchMedia !== 'function') return;

  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const handleChange = () => {
    if (getThemeMode() === 'system') applyThemeMode('system');
  };

  if (typeof media.addEventListener === 'function') {
    media.addEventListener('change', handleChange);
  } else if (typeof media.addListener === 'function') {
    media.addListener(handleChange);
  }

  return () => {
    if (typeof media.removeEventListener === 'function') {
      media.removeEventListener('change', handleChange);
    } else if (typeof media.removeListener === 'function') {
      media.removeListener(handleChange);
    }
  };
}

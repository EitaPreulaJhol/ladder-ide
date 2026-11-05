/**
 * Theme preference: 'system' follows prefers-color-scheme (CSS handles it);
 * 'light' / 'dark' force a theme through <html data-theme>. Stored per browser.
 */
export type ThemePref = 'system' | 'light' | 'dark';

const KEY = 'ladder-ide:theme';

export function getThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(pref: ThemePref): void {
  const root = document.documentElement;
  if (pref === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', pref);
}

export function setThemePref(pref: ThemePref): void {
  try {
    if (pref === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, pref);
  } catch {
    /* storage may be blocked: the choice still applies to this session */
  }
  applyTheme(pref);
}

export const NEXT_THEME: Record<ThemePref, ThemePref> = { system: 'light', light: 'dark', dark: 'system' };

/**
 * TransPop — theme helper for extension pages (ES module).
 * applyTheme('auto' | 'light' | 'dark') sets <html data-theme> and follows the OS in auto mode.
 */

let mediaQuery = null;
let mediaListener = null;

export function resolveTheme(theme) {
  if (theme === 'light' || theme === 'dark') return theme;
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(theme = 'auto', root = document.documentElement) {
  if (mediaQuery && mediaListener) mediaQuery.removeEventListener('change', mediaListener);
  mediaQuery = null;
  mediaListener = null;

  root.dataset.theme = resolveTheme(theme);

  if (theme === 'auto' && typeof matchMedia === 'function') {
    mediaQuery = matchMedia('(prefers-color-scheme: dark)');
    mediaListener = () => {
      root.dataset.theme = resolveTheme('auto');
    };
    mediaQuery.addEventListener('change', mediaListener);
  }
}

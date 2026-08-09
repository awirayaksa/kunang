import { nativeTheme } from 'electron'

let theme: 'auto' | 'light' | 'dark' = 'auto'

export function initTheme(mode: 'auto' | 'light' | 'dark' = 'auto') {
  theme = mode
}

export function setThemeMode(mode: 'auto' | 'light' | 'dark') {
  theme = mode
}

export function getThemeMode(): 'auto' | 'light' | 'dark' {
  return theme
}

// night-900 and paper from resources/BRAND.md. These must track view.css's
// --bg exactly: the window is painted with this before the renderer draws, so
// a mismatch shows as a flash of the wrong colour on every open.
const NIGHT_900 = '#070B16'
const PAPER = '#F6F4EF'

export function getThemeBackground(): string {
  if (theme === 'dark') return NIGHT_900
  if (theme === 'light') return PAPER
  return nativeTheme.shouldUseDarkColors ? NIGHT_900 : PAPER
}

export function isDark(): boolean {
  if (theme === 'dark') return true
  if (theme === 'light') return false
  return nativeTheme.shouldUseDarkColors
}

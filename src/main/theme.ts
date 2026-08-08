import { nativeTheme } from 'electron'

let theme: 'auto' | 'light' | 'dark' = 'auto'

export function initTheme() {
  // Theme is set by renderer via IPC or state.json
}

export function setThemeMode(mode: 'auto' | 'light' | 'dark') {
  theme = mode
}

export function getThemeMode(): 'auto' | 'light' | 'dark' {
  return theme
}

export function getThemeBackground(): string {
  if (theme === 'dark') return '#1e1e1e'
  if (theme === 'light') return '#ffffff'
  return nativeTheme.shouldUseDarkColors ? '#1e1e1e' : '#ffffff'
}

export function isDark(): boolean {
  if (theme === 'dark') return true
  if (theme === 'light') return false
  return nativeTheme.shouldUseDarkColors
}

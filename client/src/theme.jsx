import { useState } from 'react'

const KEY = 'qa-theme'

export function initTheme() {
  let theme = 'dark'
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === 'light' || saved === 'dark') theme = saved
  } catch { /* keep dark */ }
  document.documentElement.dataset.theme = theme
  return theme
}

export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme
  try { localStorage.setItem(KEY, theme) } catch { /* ignore */ }
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M12 2.5v2.2M12 19.3v2.2M4.8 4.8l1.6 1.6M17.6 17.6l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.8 19.2l1.6-1.6M17.6 6.4l1.6-1.6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d="M16.5 3.2a8.2 8.2 0 1 0 4.3 13.6A7 7 0 0 1 16.5 3.2z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  )
}

export function ThemeToggle({ className = '' }) {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || 'dark')
  const next = theme === 'dark' ? 'light' : 'dark'
  return (
    <button type="button" className={`theme-toggle ${className}`} aria-label={`Switch to ${next} mode`} title={`Switch to ${next} mode`} onClick={() => { applyTheme(next); setTheme(next) }}>
      {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
    </button>
  )
}

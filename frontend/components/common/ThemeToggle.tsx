'use client';

import { useTheme } from '../../context/ThemeContext';

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20.4 15.2A8.7 8.7 0 0 1 8.8 3.6 8.7 8.7 0 1 0 20.4 15.2Z" />
    </svg>
  );
}

/** Compact light/dark switch available on every route. */
export default function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const nextTheme = theme === 'dark' ? 'light' : 'dark';

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggleTheme}
      aria-label={`Switch to ${nextTheme} mode`}
      title={`Switch to ${nextTheme} mode`}
    >
      <span className="theme-toggle-icon">
        {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
      </span>
      <span className="theme-toggle-label">{nextTheme}</span>
    </button>
  );
}

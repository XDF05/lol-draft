import { render, screen, fireEvent } from '@testing-library/react';
import {
  ThemeProvider,
  useTheme,
  type Theme,
} from '../../context/ThemeContext';
import ThemeToggle from './ThemeToggle';

/** Minimal consumer that exposes the current theme via its rendered text. */
function ThemeDisplay() {
  const { theme } = useTheme();
  return <div data-testid="theme">{theme}</div>;
}

function renderWithTheme(initialTheme: Theme = 'light') {
  // Persist the initial theme so ThemeProvider restores it on mount.
  window.localStorage.setItem('lol-draft-theme', initialTheme);
  const utils = render(
    <ThemeProvider>
      <ThemeDisplay />
      <ThemeToggle />
    </ThemeProvider>,
  );
  return utils;
}

describe('ThemeToggle / ThemeContext (theme restoration)', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('defaults to light when no theme is stored', () => {
    renderWithTheme('light');
    expect(screen.getByTestId('theme')).toHaveTextContent('light');
  });

  it('restores a previously saved dark theme on mount', () => {
    renderWithTheme('dark');
    expect(screen.getByTestId('theme')).toHaveTextContent('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('applies the saved theme to the document element', () => {
    renderWithTheme('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('toggles the theme on click and persists the choice', () => {
    renderWithTheme('light');

    const button = screen.getByRole('button', {
      name: /switch to dark mode/i,
    });
    expect(button).toBeInTheDocument();

    fireEvent.click(button);

    expect(screen.getByTestId('theme')).toHaveTextContent('dark');
    expect(window.localStorage.getItem('lol-draft-theme')).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');

    // The label now advertises switching back to light.
    expect(
      screen.getByRole('button', { name: /switch to light mode/i }),
    ).toBeInTheDocument();
  });

  it('toggles back from dark to light', () => {
    renderWithTheme('dark');

    const button = screen.getByRole('button', {
      name: /switch to light mode/i,
    });
    fireEvent.click(button);

    expect(screen.getByTestId('theme')).toHaveTextContent('light');
    expect(window.localStorage.getItem('lol-draft-theme')).toBe('light');
  });
});

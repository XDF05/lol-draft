import { render, screen, fireEvent } from '@testing-library/react';
import ChampionPool from './ChampionPool';
import type { Champion } from '../../lib/types';
import type { ChampionCardStatus } from './ChampionCard';

const champions: Champion[] = [
  { id: 'Ahri', name: 'Ahri', iconUrl: 'https://cdn.example.com/Ahri.png' },
  { id: 'Akali', name: 'Akali', iconUrl: 'https://cdn.example.com/Akali.png' },
  { id: 'Annie', name: 'Annie', iconUrl: 'https://cdn.example.com/Annie.png' },
];

function statusMap(entries: Array<[string, ChampionCardStatus]>) {
  return new Map(entries);
}

function renderPool(overrides: {
  status?: 'idle' | 'loading' | 'ready' | 'error';
  error?: string | null;
  champions?: Champion[];
  statusById?: Map<string, ChampionCardStatus>;
  selectedId?: string | null;
  disabled?: boolean;
  accent?: string;
  onToggle?: (championId: string) => void;
} = {}) {
  const props = {
    champions,
    status: 'ready' as const,
    error: null,
    statusById: new Map(),
    selectedId: null,
    disabled: false,
    accent: '#2563eb',
    onToggle: jest.fn(),
    ...overrides,
  };
  render(<ChampionPool {...props} />);
  return { props };
}

describe('ChampionPool (champion states)', () => {
  it('shows a loading message while the pool is not ready', () => {
    renderPool({ status: 'loading' });
    expect(screen.getByText(/Loading champion pool/i)).toBeInTheDocument();
  });

  it('shows the error message when the pool fails to load', () => {
    renderPool({ status: 'error', error: 'Champion pool unavailable' });
    expect(screen.getByText(/Champion pool unavailable/i)).toBeInTheDocument();
  });

  it('renders all champions when ready', () => {
    renderPool();
    expect(screen.getByText('Ahri')).toBeInTheDocument();
    expect(screen.getByText('Akali')).toBeInTheDocument();
    expect(screen.getByText('Annie')).toBeInTheDocument();
    expect(screen.getByText(/3 champions/i)).toBeInTheDocument();
  });

  it('applies picked/banned states to matching champions', () => {
    renderPool({
      statusById: statusMap([
        ['Ahri', 'picked'],
        ['Zed', 'banned'],
      ]),
    });
    const ahri = screen.getByRole('button', { name: /Ahri/ });
    const akali = screen.getByRole('button', { name: /Akali/ });
    expect(ahri).toHaveAttribute('aria-disabled', 'true');
    expect(akali).toBeEnabled();
  });

  it('highlights the selected champion', () => {
    renderPool({ selectedId: 'Akali' });
    const akali = screen.getByRole('button', { name: /Akali/ });
    expect(akali).toHaveAttribute('aria-pressed', 'true');
    const ahri = screen.getByRole('button', { name: /Ahri/ });
    expect(ahri).toHaveAttribute('aria-pressed', 'false');
  });

  it('filters champions by name when searching', () => {
    renderPool();
    const search = screen.getByLabelText(/Search champions/i);
    fireEvent.change(search, { target: { value: 'ka' } });
    expect(screen.getByText('Akali')).toBeInTheDocument();
    expect(screen.queryByText('Ahri')).not.toBeInTheDocument();
    expect(screen.queryByText('Annie')).not.toBeInTheDocument();
    expect(screen.getByText(/1 champion/i)).toBeInTheDocument();
  });

  it('shows an empty message when no champions match the search', () => {
    renderPool();
    const search = screen.getByLabelText(/Search champions/i);
    fireEvent.change(search, { target: { value: 'zzz' } });
    expect(screen.getByText(/No champions match/i)).toBeInTheDocument();
  });

  it('disables all cards when the pool is disabled', () => {
    renderPool({ disabled: true });
    expect(screen.getByRole('button', { name: /Ahri/ })).toBeDisabled();
  });

  it('calls onToggle with the champion id when a card is clicked', () => {
    const { props } = renderPool();
    fireEvent.click(screen.getByRole('button', { name: /Ahri/ }));
    expect(props.onToggle).toHaveBeenCalledWith('Ahri');
  });
});

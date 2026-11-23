import { render, screen, fireEvent } from '@testing-library/react';
import { ChampionCard, type ChampionCardStatus } from './ChampionCard';
import type { Champion } from '../../lib/types';

const champion: Champion = {
  id: 'Ahri',
  name: 'Ahri',
  iconUrl: 'https://cdn.example.com/img/champion/Ahri.png',
};

function renderCard(
  overrides: Partial<Parameters<typeof ChampionCard>[0]> = {},
) {
  const props = {
    champion,
    selected: false,
    disabled: false,
    status: 'available' as ChampionCardStatus,
    onToggle: jest.fn(),
    ...overrides,
  };
  render(<ChampionCard {...props} />);
  // Each render adds a button to the DOM; take the most recently rendered one.
  const buttons = screen.getAllByRole('button');
  return { props, button: buttons[buttons.length - 1] };
}

describe('ChampionCard (champion states)', () => {
  it('renders an available champion that is selectable', () => {
    const { button, props } = renderCard({ status: 'available' });
    expect(button).toBeEnabled();
    expect(button).not.toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(button).not.toHaveAttribute('aria-busy');
    expect(props.status).toBe('available');
  });

  it('marks a selected champion with aria-pressed=true and a Selected badge', () => {
    const { button } = renderCard({ status: 'available', selected: true });
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Selected')).toBeInTheDocument();
  });

  it('disables a picked champion and announces its state', () => {
    const { button } = renderCard({ status: 'picked' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('Picked')).toBeInTheDocument();
    expect(button).toHaveClass('unavailable');
  });

  it('disables a banned champion and announces its state', () => {
    const { button } = renderCard({ status: 'banned' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('Banned')).toBeInTheDocument();
    expect(button).toHaveClass('unavailable');
  });

  it('renders a loading skeleton that is disabled and busy', () => {
    renderCard({ loading: true });
    const button = screen.getAllByRole('button')[0];
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toHaveAccessibleName('Loading champion');
    // Loading state shows skeleton placeholders instead of the name.
    expect(screen.queryByText('Ahri')).not.toBeInTheDocument();
    expect(document.querySelector('.champion-skeleton')).toBeInTheDocument();
  });

  it('calls onToggle when clicking an available champion', () => {
    const { button, props } = renderCard({ status: 'available' });
    fireEvent.click(button);
    expect(props.onToggle).toHaveBeenCalledTimes(1);
  });

  it('does not call onToggle when clicking an unavailable champion', () => {
    for (const status of ['picked', 'banned'] as const) {
      const { button, props } = renderCard({ status });
      fireEvent.click(button);
      expect(props.onToggle).not.toHaveBeenCalled();
    }
  });

  it('does not call onToggle when explicitly disabled', () => {
    const { button, props } = renderCard({
      status: 'available',
      disabled: true,
    });
    fireEvent.click(button);
    expect(props.onToggle).not.toHaveBeenCalled();
  });
});

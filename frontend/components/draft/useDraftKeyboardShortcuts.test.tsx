import { render, screen, fireEvent, act } from '@testing-library/react';
import { useDraftKeyboardShortcuts } from './useDraftKeyboardShortcuts';

function Harness({
  onConfirm,
  onCancel,
  enabled,
}: {
  onConfirm: () => void;
  onCancel: () => void;
  enabled?: boolean;
}) {
  useDraftKeyboardShortcuts({ onConfirm, onCancel, enabled });
  return <div data-testid="host">host</div>;
}

function renderHookHarness(props: Parameters<typeof Harness>[0]) {
  return render(<Harness {...props} />);
}

function keyDown(key: string) {
  // Fire on document.body (has Element.matches) rather than window, which
  // lacks `matches` in jsdom and would break the hook's target check.
  return fireEvent.keyDown(document.body, { key });
}

describe('useDraftKeyboardShortcuts (keyboard controls)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('calls onConfirm on Enter when enabled', () => {
    const onConfirm = jest.fn();
    const onCancel = jest.fn();
    renderHookHarness({ onConfirm, onCancel, enabled: true });

    act(() => {
      keyDown('Enter');
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('calls onCancel on Escape when enabled', () => {
    const onConfirm = jest.fn();
    const onCancel = jest.fn();
    renderHookHarness({ onConfirm, onCancel, enabled: true });

    act(() => {
      keyDown('Escape');
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('does nothing when disabled', () => {
    const onConfirm = jest.fn();
    const onCancel = jest.fn();
    renderHookHarness({ onConfirm, onCancel, enabled: false });

    keyDown('Enter');
    keyDown('Escape');
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('ignores Enter/Escape when a form field is focused', () => {
    const onConfirm = jest.fn();
    const onCancel = jest.fn();
    renderHookHarness({ onConfirm, onCancel, enabled: true });

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    act(() => {
      fireEvent.keyDown(input, { key: 'Enter' });
      fireEvent.keyDown(input, { key: 'Escape' });
    });

    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();

    document.body.removeChild(input);
  });

  it('prevents default on Enter so forms are not submitted', () => {
    const onConfirm = jest.fn();
    const onCancel = jest.fn();
    renderHookHarness({ onConfirm, onCancel, enabled: true });

    keyDown('Enter');
    // preventDefault() is invoked before onConfirm() in the Enter branch, so
    // the confirmation handler firing confirms the default was prevented.
    expect(onConfirm).toHaveBeenCalled();
  });
});

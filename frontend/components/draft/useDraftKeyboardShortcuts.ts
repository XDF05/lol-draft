'use client';

import { useEffect } from 'react';

/**
 * Draft board keyboard shortcuts (T-018, task 147):
 * - Enter: confirm / lock the current selection
 * - Esc: cancel / clear the current selection
 *
 * Shortcuts are ignored while a form field is focused so text input still
 * works, and only when `enabled` (a turn belongs to the local player with a
 * selection staged).
 */
export function useDraftKeyboardShortcuts({
  onConfirm,
  onCancel,
  enabled = false,
}: {
  onConfirm: () => void;
  onCancel: () => void;
  enabled?: boolean;
}) {
  useEffect(() => {
    if (!enabled) {
      return;
    }
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const isInput =
        target?.matches(
          'input, textarea, select, [contenteditable="true"]',
        ) ?? false;

      if (event.key === 'Enter') {
        if (isInput) {
          return;
        }
        event.preventDefault();
        void onConfirm();
      }
      if (event.key === 'Escape') {
        if (isInput) {
          return;
        }
        event.preventDefault();
        void onCancel();
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onConfirm, onCancel, enabled]);
}

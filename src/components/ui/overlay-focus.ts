import { useRef } from 'react';

/** Controlled overlays also restore focus when opened without a Radix Trigger. */
export function useOverlayFocus({
  onOpenAutoFocus,
  onCloseAutoFocus,
}: {
  onOpenAutoFocus?: (event: Event) => void;
  onCloseAutoFocus?: (event: Event) => void;
} = {}) {
  const opener = useRef<HTMLElement | null>(
    typeof document !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );
  return {
    onOpenAutoFocus: (event: Event) => {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      onOpenAutoFocus?.(event);
    },
    onCloseAutoFocus: (event: Event) => {
      onCloseAutoFocus?.(event);
      if (event.defaultPrevented) return;
      const target =
        opener.current?.isConnected && opener.current !== document.body
          ? opener.current
          : document.getElementById('main-content');
      if (target) {
        event.preventDefault();
        target.focus({ preventScroll: true });
      }
    },
  };
}

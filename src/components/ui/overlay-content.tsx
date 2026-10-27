import * as DialogPrimitive from '@radix-ui/react-dialog';
import type { ComponentProps } from 'react';
import { useOverlayFocus } from './overlay-focus';

/** Mount inside the Portal so the opener is captured before a child's React autoFocus runs. */
export function OverlayContent({
  onOpenAutoFocus,
  onCloseAutoFocus,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content>) {
  const focus = useOverlayFocus({ onOpenAutoFocus, onCloseAutoFocus });
  return <DialogPrimitive.Content {...props} {...focus} />;
}

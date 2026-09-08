/**
 * Pure helpers for positioning a floating element relative to an anchor rect.
 * Both InfoTooltip and DemoTutorialV2 use these to avoid duplicating the
 * "prefer-above / flip-below / clamp-to-viewport" logic.
 */

const DEFAULT_MARGIN = 16;

/**
 * Vertical position: tries above targetRect, flips below if not enough room,
 * then clamps so the menu never overflows the viewport bottom.
 */
export function computeAnchoredTop(targetRect, menuHeight, margin = DEFAULT_MARGIN) {
  let top = targetRect.top - menuHeight - margin;
  if (top < margin) top = targetRect.bottom + margin;
  const maxTop = window.innerHeight - menuHeight - margin;
  if (top > maxTop) top = Math.max(margin, maxTop);
  return Math.round(top);
}

/**
 * Horizontal position: centers the menu on the target, clamped to viewport.
 */
export function computeAnchoredLeft(targetRect, menuWidth, margin = DEFAULT_MARGIN) {
  const left = targetRect.left + targetRect.width / 2 - menuWidth / 2;
  return Math.round(Math.max(margin, Math.min(left, window.innerWidth - menuWidth - margin)));
}

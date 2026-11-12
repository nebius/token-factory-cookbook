// Map zoom on phones and tablets: one finger scrolls the page past the map, two fingers pan and zoom it. On bigger
// screens d3-zoom's usual rule applies (no right-click, ctrl only with the wheel).
export function touchFriendly(event: Event): boolean {
  if (event.type === "touchstart" && (event as TouchEvent).touches.length < 2 && window.matchMedia("(max-width: 1023px)").matches) return false;
  const e = event as MouseEvent;
  return (!e.ctrlKey || event.type === "wheel") && !e.button;
}

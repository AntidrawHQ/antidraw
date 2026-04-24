import { useEffect } from "react";

// Escape hatch for the no-useEffect rule: runs exactly once on mount,
// cleanup on unmount. Use for external-system sync (event listeners,
// third-party widgets) where deps are genuinely stable.
export const useMountEffect = (effect: () => void | (() => void)) => {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(effect, []);
};

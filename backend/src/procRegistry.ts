// Small shared list of "stop everything" functions.
// The Run button (devRunRoutes.ts) and Agent mode (agentRoutes.ts) each start servers.
// Before either one starts new servers it calls stopEverything(), so the two never fight over port 3001 / 5173.

const hooks = new Set<() => void>();

export function onStopAll(fn: () => void) {
  hooks.add(fn);
}

export function stopEverything() {
  hooks.forEach((fn) => {
    try { fn(); } catch { /* one failing hook must not block the others */ }
  });
}
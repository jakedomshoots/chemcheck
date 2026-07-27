const REACT_ROOT_KEY = Symbol.for('chemcheck.react-root');

/**
 * Keep one React root per DOM container across Vite hot-module reloads.
 * Recreating a root against the same container makes the old and new trees
 * compete over DOM nodes and can trigger removeChild errors during refresh.
 */
export function getOrCreateReactRoot(container, createRootFactory) {
  if (!container) {
    throw new Error('ChemCheck root container was not found');
  }

  if (!container[REACT_ROOT_KEY]) {
    container[REACT_ROOT_KEY] = createRootFactory(container);
  }

  return container[REACT_ROOT_KEY];
}

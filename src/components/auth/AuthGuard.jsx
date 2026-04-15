/**
 * Compatibility wrapper for legacy imports.
 *
 * Use RobustAuthGuard everywhere; this file forwards old imports to the robust guard.
 */

import { RobustAuthGuard } from './RobustAuthGuard';

export function AuthGuard({ children }) {
  return <RobustAuthGuard>{children}</RobustAuthGuard>;
}

export default AuthGuard;

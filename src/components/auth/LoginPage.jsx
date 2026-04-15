/**
 * Compatibility wrapper for legacy imports.
 *
 * The robust Clerk login flow is the canonical implementation.
 */

import { RobustLoginPage } from './RobustLoginPage';

export function LoginPage() {
  return <RobustLoginPage />;
}

export default LoginPage;

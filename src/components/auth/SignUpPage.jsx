/**
 * Compatibility wrapper for legacy imports.
 *
 * The robust Clerk sign-up flow is the canonical implementation.
 */

import { RobustSignUpPage } from './RobustSignUpPage';

export function SignUpPage() {
  return <RobustSignUpPage />;
}

export default SignUpPage;

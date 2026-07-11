type LocalUser = { email?: string | null } | null | undefined;

export function isAccountChange(localUser: LocalUser, authenticatedEmail: string): boolean {
  if (!localUser?.email) return false;
  return localUser.email.trim().toLowerCase() !== authenticatedEmail.trim().toLowerCase();
}

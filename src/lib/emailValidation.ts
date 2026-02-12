const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const RESERVED_EMAIL_DOMAINS = new Set([
  "example.com",
  "example.net",
  "example.org",
  "test.com",
  "localhost",
  "localdomain",
]);

const RESERVED_EMAIL_TLDS = new Set([
  "example",
  "invalid",
  "localhost",
  "test",
]);

export function getEmailDeliveryValidationError(rawEmail?: string | null): string | null {
  const normalized = rawEmail?.trim() || "";
  if (!normalized) {
    return "No email address on file. Please add an email address to send email reports.";
  }

  if (!EMAIL_PATTERN.test(normalized)) {
    return "The email on file is invalid. Please update the customer's email and try again.";
  }

  const parts = normalized.toLowerCase().split("@");
  if (parts.length !== 2) {
    return "The email on file is invalid. Please update the customer's email and try again.";
  }

  const domain = parts[1];
  if (!domain) {
    return "The email on file is invalid. Please update the customer's email and try again.";
  }

  if (RESERVED_EMAIL_DOMAINS.has(domain)) {
    return "This email looks like a placeholder (example.com). Please use the customer's real email.";
  }

  const tld = domain.split(".").pop();
  if (!tld || RESERVED_EMAIL_TLDS.has(tld)) {
    return "This email looks like a test address. Please use the customer's real email.";
  }

  return null;
}

export function isEmailDeliverableForReports(rawEmail?: string | null): boolean {
  return getEmailDeliveryValidationError(rawEmail) === null;
}

/**
 * SMS Service Report Utilities
 * 
 * Provides functions for formatting SMS messages and generating report tokens
 * for the customer service reports feature.
 * 
 * Requirements: 2.3, 2.4
 */

/**
 * Pool status indicator for SMS messages
 */
export type PoolStatus = 'good' | 'needs_attention';

/**
 * Formats an SMS message for a service report
 * 
 * The message includes:
 * - Business name
 * - Service date
 * - Overall pool status (good/needs attention)
 * - Report link
 * 
 * Uses ASCII characters only to ensure GSM-7 encoding (160 char limit).
 * Using emoji/unicode would trigger UCS-2 encoding (70 char limit per segment).
 * 
 * @param businessName - The name of the pool service business
 * @param serviceDate - The date of service (formatted string, e.g., "12/21/2025")
 * @param overallStatus - The overall pool status ('good' or 'needs_attention')
 * @param reportLink - The full URL to the service report
 * @returns The formatted SMS message string
 * 
 * Requirements: 2.3
 */
export function formatSmsMessage(
  businessName: string,
  serviceDate: string,
  overallStatus: PoolStatus,
  reportLink?: string
): string {
  // Truncate business name if too long to help stay under 160 chars
  const maxBusinessNameLength = 30;
  const truncatedBusinessName = businessName.length > maxBusinessNameLength
    ? businessName.slice(0, maxBusinessNameLength - 3) + '...'
    : businessName;

  // Use ASCII characters only to ensure GSM-7 encoding (160 char limit)
  // Emoji characters would trigger UCS-2 encoding (70 char limit per segment)
  const statusText = overallStatus === 'good' 
    ? 'OK' 
    : 'Needs Attention';

  const baseMessage = `${truncatedBusinessName} - Service completed ${serviceDate}\nPool Status: ${statusText}`;
  const message = reportLink
    ? `${baseMessage}\nView report: ${reportLink}`
    : `${baseMessage}\nReport link is added when sent.`;

  return message;
}

/**
 * Generates a unique, URL-safe report token using crypto.randomUUID
 * 
 * The token is a UUID v4 (36 characters, 122 bits of entropy) which provides:
 * - Sufficient entropy to be unguessable
 * - URL-safe characters (alphanumeric and hyphens)
 * - Standard format for easy validation
 * 
 * @returns A unique UUID v4 token string
 * 
 * Requirements: 2.4
 */
export function generateReportToken(): string {
  // crypto.randomUUID() generates a UUID v4 which is:
  // - 36 characters long (including hyphens)
  // - Format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
  // - URL-safe (only contains 0-9, a-f, and hyphens)
  return crypto.randomUUID();
}

/**
 * Validates that a string is a valid UUID v4 format
 * 
 * @param token - The token string to validate
 * @returns true if the token is a valid UUID v4 format
 */
export function isValidReportToken(token: string): boolean {
  // UUID v4 regex pattern
  const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidV4Pattern.test(token);
}

/**
 * Builds a full report URL from a base URL and token
 * 
 * @param baseUrl - The base URL of the application (e.g., "https://app.example.com")
 * @param token - The report token
 * @returns The full report URL
 */
export function buildReportUrl(baseUrl: string, token: string): string {
  // Remove trailing slash from base URL if present
  const cleanBaseUrl = baseUrl.replace(/\/$/, '');
  return `${cleanBaseUrl}/report/${token}`;
}

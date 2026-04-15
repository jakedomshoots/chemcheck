/**
 * Phone number validation and normalization utilities
 * Supports US phone numbers in various formats
 * 
 * Requirements: 4.4, 4.5
 */

export interface PhoneValidationResult {
  isValid: boolean;
  normalized?: string; // E.164 format: +1XXXXXXXXXX
  error?: string;
}

/**
 * Strips all non-digit characters from a phone number string
 */
function stripNonDigits(phone: string): string {
  return phone.replace(/\D/g, '');
}

/**
 * Validates a US phone number and returns the result with normalized format
 * 
 * Supported input formats:
 * - 555-123-4567
 * - (555) 123-4567
 * - 5551234567
 * - +1 555 123 4567
 * - 1-555-123-4567
 * 
 * @param input - The phone number string to validate
 * @returns PhoneValidationResult with isValid, normalized (E.164), and error
 */
export function validatePhoneNumber(input: string): PhoneValidationResult {
  if (!input || typeof input !== 'string') {
    return {
      isValid: false,
      error: 'Phone number is required',
    };
  }

  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return {
      isValid: false,
      error: 'Phone number is required',
    };
  }

  // Strip all non-digit characters
  const digits = stripNonDigits(trimmed);

  // Check for valid digit counts
  // 10 digits: area code + number (5551234567)
  // 11 digits: country code + area code + number (15551234567)
  if (digits.length < 10) {
    return {
      isValid: false,
      error: 'Phone number is incomplete',
    };
  }

  if (digits.length > 11) {
    return {
      isValid: false,
      error: 'Phone number is too long',
    };
  }

  let normalizedDigits: string;

  if (digits.length === 10) {
    // Assume US number without country code
    normalizedDigits = digits;
  } else {
    // digits.length === 11 (guaranteed by earlier validation)
    // Should start with 1 for US
    if (digits[0] !== '1') {
      return {
        isValid: false,
        error: 'Invalid country code for US number',
      };
    }
    normalizedDigits = digits.substring(1);
  }

  // Validate area code (first digit must be 2-9 for US)
  const areaCode = normalizedDigits[0];
  if (areaCode < '2' || areaCode > '9') {
    return {
      isValid: false,
      error: 'Invalid area code',
    };
  }

  // Validate exchange code (4th digit must be 2-9 for US)
  const exchangeCode = normalizedDigits[3];
  if (exchangeCode < '2' || exchangeCode > '9') {
    return {
      isValid: false,
      error: 'Invalid exchange code',
    };
  }

  // Return normalized E.164 format
  return {
    isValid: true,
    normalized: `+1${normalizedDigits}`,
  };
}

/**
 * Normalizes a phone number to E.164 format (+1XXXXXXXXXX)
 * Throws an error if the phone number is invalid
 * 
 * @param phone - The phone number string to normalize
 * @param defaultCountry - Default country code (currently only 'US' is supported)
 * @returns The normalized phone number in E.164 format
 * @throws Error if the phone number is invalid
 */
export function normalizeToE164(phone: string, defaultCountry: string = 'US'): string {
  if (defaultCountry !== 'US') {
    throw new Error('Only US phone numbers are supported');
  }

  const result = validatePhoneNumber(phone);
  
  if (!result.isValid) {
    throw new Error(result.error || 'Invalid phone number');
  }

  return result.normalized!;
}

/**
 * Masks a phone number for display, showing only the last 4 digits
 * Example: +15551234567 -> •••• •••• 4567
 * 
 * @param phone - The phone number to mask (E.164 format preferred)
 * @returns The masked phone number string
 */
export function maskPhoneNumber(phone: string): string {
  const digits = stripNonDigits(phone);
  
  if (digits.length < 4) {
    return '•••• •••• ••••';
  }

  const lastFour = digits.slice(-4);
  return `•••• •••• ${lastFour}`;
}

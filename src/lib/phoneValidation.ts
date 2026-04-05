export interface PhoneValidationResult {
  isValid: boolean;
  normalized?: string; // E.164 format: +1XXXXXXXXXX
  error?: string;
}

function stripNonDigits(phone: string): string {
  return phone.replace(/\D/g, '');
}

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

  const digits = stripNonDigits(trimmed);

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
    normalizedDigits = digits;
  } else {
    if (digits[0] !== '1') {
      return {
        isValid: false,
        error: 'Invalid country code for US number',
      };
    }
    normalizedDigits = digits.substring(1);
  }

  const areaCode = normalizedDigits[0];
  if (areaCode < '2' || areaCode > '9') {
    return {
      isValid: false,
      error: 'Invalid area code',
    };
  }

  const exchangeCode = normalizedDigits[3];
  if (exchangeCode < '2' || exchangeCode > '9') {
    return {
      isValid: false,
      error: 'Invalid exchange code',
    };
  }

  return {
    isValid: true,
    normalized: `+1${normalizedDigits}`,
  };
}

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

export function maskPhoneNumber(phone: string): string {
  const digits = stripNonDigits(phone);
  
  if (digits.length < 4) {
    return '•••• •••• ••••';
  }

  const lastFour = digits.slice(-4);
  return `•••• •••• ${lastFour}`;
}

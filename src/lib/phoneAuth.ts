export interface CountryDialOption {
  code: string;
  label: string;
  flag: string;
}

export const COUNTRY_DIAL_CODES: CountryDialOption[] = [
  { code: '228', label: 'Togo (+228)', flag: 'TG' },
  { code: '229', label: 'Bénin (+229)', flag: 'BJ' },
  { code: '225', label: "Côte d'Ivoire (+225)", flag: 'CI' },
  { code: '226', label: 'Burkina Faso (+226)', flag: 'BF' },
  { code: '221', label: 'Sénégal (+221)', flag: 'SN' },
  { code: '223', label: 'Mali (+223)', flag: 'ML' },
  { code: '227', label: 'Niger (+227)', flag: 'NE' },
  { code: '233', label: 'Ghana (+233)', flag: 'GH' },
  { code: '237', label: 'Cameroun (+237)', flag: 'CM' },
  { code: '241', label: 'Gabon (+241)', flag: 'GA' },
  { code: '243', label: 'RD Congo (+243)', flag: 'CD' },
  { code: '33', label: 'France (+33)', flag: 'FR' },
  { code: '1', label: 'USA / Canada (+1)', flag: 'US' },
];

export const PHONE_AUTH_DOMAIN = 'tel.schoolaria.app';
const PHONE_AUTH_EMAIL_REGEX = /^tel\.([0-9]{7,15})@tel\.schoolaria\.app$/i;

/**
 * Normalizes a phone number into canonical international digits (without '+').
 * Returns '' if the input contains invalid characters or does not have 7..15 digits.
 */
export function normalizePhoneDigits(
  rawPhone: string,
  defaultCountryCode = '228'
): string {
  const trimmed = (rawPhone ?? '').trim();
  if (!trimmed) return '';
  if (/[a-zA-Z@]/.test(trimmed)) return '';

  const cleanDefaultCode = defaultCountryCode.replace(/\D/g, '');
  const hasPlusPrefix = trimmed.startsWith('+');
  const hasDoubleZeroPrefix = trimmed.startsWith('00');

  let digits = trimmed.replace(/\D/g, '');
  if (!digits) return '';

  if (hasDoubleZeroPrefix && digits.startsWith('00')) {
    digits = digits.slice(2);
  } else if (!hasPlusPrefix && cleanDefaultCode) {
    // Local West African 8-digit numbers (or 9/10-digit local numbers starting with 0)
    if (digits.length === 8) {
      digits = `${cleanDefaultCode}${digits}`;
    } else if (digits.length === 9 || digits.length === 10) {
      if (digits.startsWith('0')) {
        digits = `${cleanDefaultCode}${digits.slice(1)}`;
      } else if (!digits.startsWith(cleanDefaultCode)) {
        digits = `${cleanDefaultCode}${digits}`;
      }
    }
  }

  if (digits.length < 7 || digits.length > 15) {
    return '';
  }

  return digits;
}

/**
 * Converts a user phone number into the deterministic internal Firebase Auth identifier.
 * Example: "+228 90 12 34 56" -> "tel.22890123456@tel.schoolaria.app"
 */
export function phoneToAuthEmail(
  rawPhone: string,
  defaultCountryCode = '228'
): string {
  const digits = normalizePhoneDigits(rawPhone, defaultCountryCode);
  if (!digits) return '';
  return `tel.${digits}@${PHONE_AUTH_DOMAIN}`;
}

export function isPhoneAuthEmail(email?: string | null): boolean {
  const clean = (email ?? '').trim().toLowerCase();
  return PHONE_AUTH_EMAIL_REGEX.test(clean);
}

/**
 * Formats an internal phone-auth email ("tel.22890123456@tel.schoolaria.app")
 * for clean human display ("+228 90 12 34 56").
 */
export function formatPhoneDisplayFromAuthEmail(email: string): string {
  const match = (email ?? '').trim().toLowerCase().match(PHONE_AUTH_EMAIL_REGEX);
  if (!match) return (email ?? '').trim();
  const digits = match[1];

  // Format known 3-digit West/Central African country codes + 8-digit local numbers: +228 90 12 34 56
  if (digits.length === 11 && /^(228|229|225|226|221|223|227|233|237|241)/.test(digits)) {
    const cc = digits.slice(0, 3);
    const rest = digits.slice(3);
    const pairs = rest.match(/.{1,2}/g)?.join(' ') ?? rest;
    return `+${cc} ${pairs}`;
  }

  if (digits.startsWith('33') && digits.length === 11) {
    return `+33 ${digits[2]} ${digits.slice(3).match(/.{1,2}/g)?.join(' ') ?? ''}`.trim();
  }

  return `+${digits}`;
}

export function formatAuthIdentifierForDisplay(identifier?: string | null): string {
  const clean = (identifier ?? '').trim();
  if (!clean) return '';
  if (isPhoneAuthEmail(clean)) {
    return formatPhoneDisplayFromAuthEmail(clean);
  }
  return clean;
}

export interface ResolvedAuthIdentifier {
  authEmail: string;
  isPhone: boolean;
  displayLabel: string;
}

/**
 * Resolves either a phone number OR a standard e-mail into the canonical identifier
 * used for Firebase Auth and Schoolaria Firestore access matching.
 */
export function resolveIdentifierToAuthEmail(
  rawInput: string,
  defaultCountryCode = '228'
): ResolvedAuthIdentifier {
  const trimmed = (rawInput ?? '').trim();
  if (!trimmed) {
    return { authEmail: '', isPhone: false, displayLabel: '' };
  }

  if (trimmed.includes('@')) {
    const lower = trimmed.toLowerCase();
    return {
      authEmail: lower,
      isPhone: isPhoneAuthEmail(lower),
      displayLabel: formatAuthIdentifierForDisplay(lower),
    };
  }

  const authEmail = phoneToAuthEmail(trimmed, defaultCountryCode);
  return {
    authEmail,
    isPhone: true,
    displayLabel: authEmail ? formatPhoneDisplayFromAuthEmail(authEmail) : trimmed,
  };
}

export function isUserAccountVerified(
  user: { email?: string | null; emailVerified?: boolean | null } | null
): boolean {
  if (!user) return false;
  return Boolean(user.emailVerified) || isPhoneAuthEmail(user.email);
}

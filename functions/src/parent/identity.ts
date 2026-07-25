/**
 * --------------------------------------------------------------------
 * File:
 * parent/identity.ts
 *
 * Purpose:
 * Phone normalization — the single boundary point referenced by
 * types/parent.ts's doc comments ("Normalization happens once, at the
 * boundary... never repeated ad hoc"). Every OTP send/verify call and
 * every future ParentAccount lookup should normalize through here,
 * not with inline regex scattered across call sites.
 *
 * Scoped to Indian mobile numbers ONLY — matches this project's
 * existing India-only scope (DLT registration, ₹ currency, category/
 * religion/TC fields throughout Admission). Not a general E.164
 * parser; if this project ever needs other countries, this function
 * is where that support gets added, not worked around at call sites.
 *
 * Responsibilities:
 * ✅ Accept common Indian input formats (with/without +91, spaces,
 *    dashes, a leading 0) and return E.164, or null if invalid
 *
 * Does NOT:
 * ❌ Validate that the number is currently reachable/active — only
 *    that it's shaped like a valid Indian mobile number
 * --------------------------------------------------------------------
 */

/** Indian mobile numbers: 10 digits, starting 6-9 (per TRAI numbering plan). */
const INDIAN_MOBILE_REGEX = /^[6-9]\d{9}$/;

/**
 * Returns E.164 ("+919876543210") or null if `raw` doesn't resolve to
 * a valid 10-digit Indian mobile number once formatting is stripped.
 *
 * Disambiguates by total digit count rather than blindly stripping a
 * "91" prefix — a bare 10-digit number that happens to start with 91
 * (e.g. "9198765432") is a real, valid number, and naively stripping
 * its first two digits as if they were a country code would corrupt
 * it into an 8-digit, invalid number instead.
 */
export function normalizeIndianPhone(raw: string): string | null {
  const stripped = raw.replace(/[\s\-()]/g, "").replace(/^\+/, "");

  let digits: string;
  if (stripped.length === 10) {
    digits = stripped;
  } else if (stripped.length === 12 && stripped.startsWith("91")) {
    digits = stripped.slice(2);
  } else if (stripped.length === 11 && stripped.startsWith("0")) {
    digits = stripped.slice(1);
  } else {
    return null;
  }

  if (!INDIAN_MOBILE_REGEX.test(digits)) {
    return null;
  }

  return `+91${digits}`;
}
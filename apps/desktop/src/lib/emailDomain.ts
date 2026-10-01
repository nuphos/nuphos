// RFC 1035-ish hostname: dot-separated labels, at least one dot so bare TLDs
// like "com" can't slip through.
const DOMAIN_RE = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/

/** Extract the normalized domain from an email address; null if malformed. */
export function extractEmailDomain(email: string): string | null {
  const at = email.lastIndexOf('@')

  if (at < 0) return null
  const domain = email
    .slice(at + 1)
    .trim()
    .toLowerCase()

  return DOMAIN_RE.test(domain) ? domain : null
}

// HTML5-style local part (the bit before the '@'): no whitespace, no stray
// '@'. Kept permissive on punctuation but strict enough to reject the malformed
// cases a domain-only check misses — "@company.com" (empty local),
// "user name@company.com" (space), "user@@company.com" (double '@').
const LOCAL_PART_RE = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+$/

/**
 * Validate a sign-in email. Personal and work addresses are both valid here:
 * email-domain trust is only used later for workspace discovery, where public
 * mailbox providers remain excluded by the backend. This function only checks
 * the whole address — exactly one '@', a non-empty local part, and a real
 * domain.
 */
export function signInEmailError(email: string): string | null {
  const trimmed = email.trim()
  const at = trimmed.lastIndexOf('@')

  // Require exactly one '@' (lastIndexOf === indexOf) with a non-empty,
  // well-formed local part before it.
  if (at < 1 || trimmed.indexOf('@') !== at || !LOCAL_PART_RE.test(trimmed.slice(0, at))) {
    return 'Enter a valid email address.'
  }
  const domain = extractEmailDomain(trimmed)

  if (!domain) return 'Enter a valid email address.'

  return null
}

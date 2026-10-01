// Kubernetes resource quantities: CPU in cores with SI suffixes down to nano
// ("1m", "123456n", "0.5"), memory in bytes with binary or decimal suffixes
// ("5Mi", "1234Ki", "2G", "1048576").
const SCALES: Record<string, number> = {
  n: 1e-9,
  u: 1e-6,
  m: 1e-3,
  k: 1e3,
  M: 1e6,
  G: 1e9,
  T: 1e12,
  P: 1e15,
  Ki: 2 ** 10,
  Mi: 2 ** 20,
  Gi: 2 ** 30,
  Ti: 2 ** 40,
  Pi: 2 ** 50,
}
const SUFFIXES = Object.keys(SCALES).sort((a, b) => b.length - a.length)

/** A quantity in its base unit: cores for CPU, bytes for memory. */
export function quantityValue(quantity: string): number | null {
  const text = quantity.trim()
  const suffix = SUFFIXES.find((s) => text.endsWith(s)) ?? ''
  const digits = text.slice(0, text.length - suffix.length)

  // Number() accepts too much ("0x10", "Infinity", "") for a quantity; keep
  // it to a plain decimal with an optional exponent.
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/.test(digits)) return null

  return Number(digits) * (SCALES[suffix] ?? 1)
}

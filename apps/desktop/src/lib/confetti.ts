// Pure config for the one-shot landing confetti burst. Rendering is delegated
// to `canvas-confetti` in components/ConfettiBurst.tsx; what stays here is the
// part worth unit-testing — the shot geometry and the theme-color conversion.

/** The subset of canvas-confetti options a landing shot pins down. */
export type ConfettiShot = {
  particleCount: number
  /** Degrees, canvas-confetti convention: 90 is straight up. */
  angle: number
  spread: number
  startVelocity: number
  /** Fraction of the viewport: x 0→left edge, y 1→bottom edge. */
  origin: { x: number; y: number }
  /** Frames until a particle fades out. */
  ticks: number
}

/**
 * `index.css` stores theme colors as `"R, G, B"` triplets (the tailwind
 * `withOpacity` convention); canvas-confetti wants hex strings. Returns null
 * for anything that isn't a clean triplet so a malformed/missing variable
 * degrades to the library's default palette instead of black confetti.
 */
export function cssTripletToHex(value: string): string | null {
  const parts = value.split(',').map((p) => p.trim())

  if (parts.length !== 3) return null
  const channels: number[] = []

  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const n = Number(part)

    if (n > 255) return null
    channels.push(n)
  }

  return `#${channels.map((n) => n.toString(16).padStart(2, '0')).join('')}`
}

/**
 * Two cannons at the bottom corners firing up and inward — the classic
 * celebration shape, and it keeps the center of the screen (where the
 * workspace content lands) clear at the moment of the burst. Each side layers
 * a fast narrow jet under a slower wide spray so the burst reads as paper
 * confetti rather than a uniform fan.
 */
export function landingBurstShots(): ConfettiShot[] {
  const cannon = (origin: { x: number; y: number }, angle: number): ConfettiShot[] => [
    { particleCount: 50, angle, spread: 55, startVelocity: 75, origin, ticks: 240 },
    { particleCount: 30, angle, spread: 100, startVelocity: 45, origin, ticks: 200 },
  ]

  return [
    ...cannon({ x: 0.08, y: 1 }, 60), // left cannon, aiming up-right
    ...cannon({ x: 0.92, y: 1 }, 120), // right cannon, aiming up-left
  ]
}

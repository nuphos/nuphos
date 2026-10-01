export function normalizeHexColor(color: string | null | undefined): string | null {
  if (!color || !/^#?[0-9a-f]{6}$/i.test(color)) return null

  return color.startsWith('#') ? color : `#${color}`
}

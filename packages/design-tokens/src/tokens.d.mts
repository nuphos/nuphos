export type TokenValue = string | { color: string; alpha: number }
export type Theme = Record<string, TokenValue>

export const themes: { light: Theme; dark: Theme }
export function cssVariable(name: string): string
export function hexToChannels(hex: string): string
export function isTranslucent(value: TokenValue): value is { color: string; alpha: number }
export function cssValue(value: TokenValue): string

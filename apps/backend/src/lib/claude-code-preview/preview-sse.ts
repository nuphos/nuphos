export type PreviewEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'turn-complete'; stopReason: string }
  | { type: 'error'; code: string; message: string }

export function encodePreviewSse(event: PreviewEvent): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`)
}

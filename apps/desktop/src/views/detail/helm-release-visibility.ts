export function helmValuesAreVisible(
  revealedPayloadKey: string | null,
  currentPayloadKey: string,
): boolean {
  return revealedPayloadKey === currentPayloadKey
}

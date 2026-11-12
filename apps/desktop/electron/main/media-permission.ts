/**
 * Whether a media request may use the microphone: audio only, never the camera,
 * and only from the app's own page (`app://`, or the dev server in development).
 * Composer voice input is the one caller.
 */
export function grantsMicrophone(
  requestingUrl: string,
  mediaTypes: readonly string[] | undefined,
  appUrl: string,
): boolean {
  let actual: URL
  let expected: URL

  try {
    actual = new URL(requestingUrl)
    expected = new URL(appUrl)
  } catch {
    return false
  }
  const types = mediaTypes ?? []

  return (
    actual.protocol === expected.protocol &&
    actual.host === expected.host &&
    types.length > 0 &&
    types.every((type) => type === 'audio')
  )
}

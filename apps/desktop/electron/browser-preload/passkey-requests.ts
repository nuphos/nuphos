type CredentialOptions = { publicKey?: unknown; mediation?: string; signal?: AbortSignal }
type CredentialCall = (this: unknown, options?: CredentialOptions) => Promise<unknown>

/** The parts of a page's global object this touches (the Electron tsconfig has no DOM types). */
export type PasskeyPage = {
  navigator: { credentials?: object }
  PublicKeyCredential?: {
    getClientCapabilities?: () => Promise<Record<string, boolean | undefined>>
  }
}

/**
 * Reports each passkey request a page starts and ends, and returns how to cancel one. Electron
 * shows nothing for a request and has no way to end it, so a page waits forever on a passkey
 * this browser cannot reach. Also stops the page being told that such passkeys work here.
 *
 * Runs in the page's main world through `contextBridge.executeInMainWorld`, which serializes the
 * function, so it must not reference anything outside its own body.
 */
export function watchPasskeyRequests(
  report: (id: number, waiting: boolean) => void,
  page = globalThis as unknown as PasskeyPage,
): (id: number) => void {
  const pending = new Map<number, AbortController>()
  let last = 0
  // What a page gets when the person dismisses Chrome's own passkey window.
  const cancel = (id: number) =>
    pending
      .get(id)
      ?.abort(
        new DOMException('The operation either timed out or was not allowed.', 'NotAllowedError'),
      )
  const container = page.navigator.credentials
    ? (Object.getPrototypeOf(page.navigator.credentials) as object)
    : undefined

  for (const method of ['get', 'create'] as const) {
    const native = (container as Record<string, CredentialCall> | undefined)?.[method]

    if (!native) continue
    const watched: CredentialCall = function (options) {
      // A conditional request waits behind a form field by design, with nothing to cancel.
      if (!options?.publicKey || options.mediation === 'conditional')
        return native.call(this, options)
      const id = ++last
      const stop = new AbortController()
      const signal = options.signal ? AbortSignal.any([options.signal, stop.signal]) : stop.signal

      pending.set(id, stop)
      report(id, true)

      return native.call(this, { ...options, signal }).finally(() => {
        pending.delete(id)
        report(id, false)
      })
    }

    Object.defineProperty(watched, 'name', { value: method })
    Object.defineProperty(container, method, { value: watched, configurable: true, writable: true })
  }
  const credential = page.PublicKeyCredential
  const capabilities = credential?.getClientCapabilities?.bind(credential)

  // Electron answers true for both and serves neither: no phone sign-in, no passkeys saved here.
  if (credential && capabilities)
    credential.getClientCapabilities = async function getClientCapabilities() {
      const all = await capabilities()

      return {
        ...all,
        hybridTransport: false,
        passkeyPlatformAuthenticator: all.userVerifyingPlatformAuthenticator ?? false,
      }
    }

  return cancel
}

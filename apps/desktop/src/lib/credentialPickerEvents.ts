/**
 * Opens the composer's credential or device picker from elsewhere in the same
 * chat pane. The event goes to that pane's element only, so a split window
 * opens the picker beside the control that asked.
 */
const EVENT = 'nuphos:open-credential-picker'
const PANE = '[data-workspace-focus-surface="session"]'

export function requestCredentialPicker(from: Element, devices: boolean): void {
  from.closest(PANE)?.dispatchEvent(new CustomEvent(EVENT, { detail: { devices } }))
}

export function onCredentialPickerRequest(
  inside: Element,
  devices: boolean,
  open: () => void,
): () => void {
  const pane = inside.closest(PANE)
  const listener = (event: Event) => {
    if ((event as CustomEvent<{ devices: boolean }>).detail.devices === devices) open()
  }

  pane?.addEventListener(EVENT, listener)

  return () => pane?.removeEventListener(EVENT, listener)
}

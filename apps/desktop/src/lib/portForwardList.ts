export const PORT_FORWARD_LIST_OPEN_EVENT = 'atlas:port-forward-list-open'

export function requestOpenPortForwardList() {
  window.dispatchEvent(new Event(PORT_FORWARD_LIST_OPEN_EVENT))
}

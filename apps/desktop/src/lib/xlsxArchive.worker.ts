import { unpackXlsx } from './xlsxArchive'

self.onmessage = (event: MessageEvent<Uint8Array>) => {
  try {
    self.postMessage({ parts: unpackXlsx(event.data) })
  } catch {
    self.postMessage({ failed: true })
  }
}

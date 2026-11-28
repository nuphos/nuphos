import { XLSX_MAX_BYTES } from './xlsxLimits.ts'
import { parseXlsxParts } from './xlsxXml.ts'

export { XLSX_MAX_BYTES }
export function isXlsxFile(name: string, mime?: string | null): boolean {
  if (/\.(xls|xlsm|xlsb)$/i.test(name.trim())) return false

  return (
    /\.xlsx$/i.test(name.trim()) ||
    mime?.split(';')[0].trim().toLowerCase() ===
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  )
}

/** Untrusted ZIP inflation is off the UI thread and can be terminated. */
export function loadXlsx(bytes: Uint8Array, signal: AbortSignal) {
  return new Promise<ReturnType<typeof parseXlsxParts>>((resolve, reject) => {
    if (signal.aborted || bytes.length > XLSX_MAX_BYTES) {
      reject(new Error('XLSX unavailable'))

      return
    }
    const worker = new Worker(new URL('./xlsxArchive.worker.ts', import.meta.url), {
      type: 'module',
    })
    const stop = () => {
      worker.terminate()
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
    }
    const abort = () => {
      stop()
      reject(new Error('XLSX cancelled'))
    }
    const timer = setTimeout(abort, 5000)

    signal.addEventListener('abort', abort, { once: true })
    worker.onerror = () => {
      stop()
      reject(new Error('XLSX unavailable'))
    }
    worker.onmessage = (event: MessageEvent<{ parts?: Record<string, string> }>) => {
      stop()
      try {
        if (!event.data.parts) throw new Error('XLSX unavailable')
        resolve(parseXlsxParts(event.data.parts))
      } catch (error) {
        reject(error instanceof Error ? error : new Error('XLSX unavailable'))
      }
    }
    worker.postMessage(bytes)
  })
}

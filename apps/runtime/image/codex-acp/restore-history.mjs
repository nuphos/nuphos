import { createInterface as nuphosCreateLines } from 'node:readline'

// Decode complete lines once instead of repeatedly scanning an accumulating
// multi-megabyte JSON response. readline also preserves split UTF-8 characters.
export function nuphosListenJsonLines(readable, callback) {
  const lines = nuphosCreateLines({ input: readable, crlfDelay: Infinity })
  lines.on('line', (line) => {
    let message
    try {
      message = JSON.parse(line)
    } catch {
      return
    }
    if (message && typeof message === 'object' && message.jsonrpc === undefined)
      message.jsonrpc = '2.0'
    callback(message)
  })
  return { dispose: () => lines.close() }
}

// Only use on UI history snapshots, never on prompts or the persisted rollout.
export function nuphosOmitRestoreImages(value) {
  if (!value || typeof value !== 'object') return value
  if (value.type === 'imageGeneration' || value.type === 'image_generation_call') value.result = ''
  if (value.type === 'image' && typeof value.data === 'string') {
    return { type: 'text', text: '[Image omitted during restore]' }
  }
  for (const key of Object.keys(value)) {
    const item = value[key]
    value[key] =
      typeof item === 'string' && /^data:image\//i.test(item)
        ? '[Image omitted during restore]'
        : nuphosOmitRestoreImages(item)
  }
  return value
}

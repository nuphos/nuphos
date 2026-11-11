import { AppError } from '@/lib/errors'
import { RUNTIME_FILE_LIMIT } from './runtime-file-program'

const unavailable = () =>
  new AppError(
    503,
    'runtime_file_unavailable',
    'The source agent is offline or does not support file preview.',
  )

export function parseRuntimeFile(output: string) {
  if (output.length > 750_000) throw unavailable()
  let result: { name?: unknown; data?: unknown; size?: unknown; error?: unknown }

  try {
    result = JSON.parse(output)
  } catch {
    throw unavailable()
  }
  if (!result || typeof result !== 'object') throw unavailable()
  const errors: Record<string, [400 | 403 | 404 | 413, string]> = {
    file_not_found: [404, 'The file no longer exists on this agent.'],
    forbidden_path: [
      403,
      'Only files inside the source runtime workspace or this conversation’s home can be previewed.',
    ],
    invalid_path: [400, 'Invalid file path.'],
    not_a_file: [400, 'This path is not a regular file.'],
    file_too_large: [413, 'File preview is limited to 512 KiB.'],
  }

  if (typeof result.error === 'string') {
    const failure = Object.hasOwn(errors, result.error) ? errors[result.error] : undefined

    if (failure) throw new AppError(failure[0], result.error, failure[1])
    throw unavailable()
  }
  if (
    typeof result.name !== 'string' ||
    typeof result.data !== 'string' ||
    typeof result.size !== 'number' ||
    !Number.isInteger(result.size) ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(result.data) ||
    result.size > RUNTIME_FILE_LIMIT ||
    result.size < 0 ||
    Buffer.from(result.data, 'base64').length !== result.size
  )
    throw unavailable()

  return { name: result.name, data: result.data, size: result.size }
}

export type RuntimeDirectory = {
  entries: { name: string; kind: 'directory' | 'file' }[]
  truncated: boolean
}

export function parseRuntimeDirectory(output: string): RuntimeDirectory {
  if (output.length > 750_000) throw unavailable()
  let result: RuntimeDirectory & { error?: string }

  try {
    result = JSON.parse(output)
  } catch {
    throw unavailable()
  }
  if (result?.error) {
    if (result.error === 'not_a_directory')
      throw new AppError(400, 'not_a_directory', 'This path is not a directory.')
    parseRuntimeFile(output)
  }
  if (
    !result ||
    !Array.isArray(result.entries) ||
    result.entries.length > 500 ||
    typeof result.truncated !== 'boolean' ||
    result.entries.some(
      (entry) =>
        !entry ||
        typeof entry.name !== 'string' ||
        !entry.name ||
        entry.name === '.' ||
        entry.name === '..' ||
        /[\\/\0]/.test(entry.name) ||
        !['file', 'directory'].includes(entry.kind),
    )
  )
    throw unavailable()

  return { entries: result.entries, truncated: result.truncated }
}

export function parseRuntimeStat(output: string) {
  let result: { name?: unknown; size?: unknown; error?: unknown }

  try {
    result = JSON.parse(output)
  } catch {
    throw unavailable()
  }
  if (result.error) parseRuntimeFile(output)
  if (typeof result.name !== 'string' || !Number.isSafeInteger(result.size)) throw unavailable()

  return { name: result.name, size: result.size as number }
}

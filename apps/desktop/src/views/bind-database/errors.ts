import { parseAtlasError } from '../../api'

export function friendlyDatabaseError(cause: unknown): string {
  const parsed = parseAtlasError(cause)

  if (/aborted due to timeout|timed?\s*out/i.test(parsed.message)) {
    return 'Database connection check timed out. Verify network reachability and try again.'
  }

  return parsed.message.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/i, '')
}

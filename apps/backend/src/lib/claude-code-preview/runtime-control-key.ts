import { createHmac } from 'node:crypto'

/**
 * The operator key for a runtime connected with only its password. Must match
 * `nuphos-runtime-start` in the runtime image, which derives the same key from the
 * password it was started with; the test vectors are pinned on both sides. Not the
 * password itself: openab discards an operator key equal to the transport key.
 */
export function deriveRuntimeControlKey(password: string): string {
  return createHmac('sha256', password).update('nuphos-runtime-control-v1').digest('hex')
}

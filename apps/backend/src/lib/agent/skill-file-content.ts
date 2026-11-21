import { z } from 'zod'

import { AppError } from '@/lib/errors'
import { findEmbeddedSecret } from '@/lib/secrets/scan'

export const skillFileEncodingInput = z
  .enum(['utf8', 'base64'])
  .optional()
  .describe(
    'How `content` is encoded: "utf8" text (default), or "base64" for binary files such as images, audio or archives.',
  )

export type SkillFileEncoding = z.infer<typeof skillFileEncodingInput>

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/u

/** A tool file's bytes: its text as UTF-8, or its base64 decoded strictly. */
export function decodeSkillFileContent(
  path: string,
  content: string,
  encoding: SkillFileEncoding,
): Buffer {
  if (encoding !== 'base64') return Buffer.from(content, 'utf8')
  const compact = content.replace(/\s+/gu, '')

  // Buffer.from skips characters it cannot decode, which would store corrupt bytes.
  if (compact.length % 4 !== 0 || !BASE64.test(compact)) {
    throw new AppError(400, 'invalid_input', `${path} is not valid base64`)
  }

  return Buffer.from(compact, 'base64')
}

/** Why `bytes` must not be stored, scanning any file that reads as text, base64 or not. */
export async function skillFileSecret(bytes: Buffer): Promise<string | null> {
  let text: string

  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }

  return findEmbeddedSecret(text)
}

/** The content type a file is stored with: binary files are not served as text. */
export function skillFileContentType(encoding: SkillFileEncoding): string {
  return encoding === 'base64' ? 'application/octet-stream' : 'text/plain'
}

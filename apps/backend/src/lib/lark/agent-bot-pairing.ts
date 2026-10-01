import { randomInt } from 'node:crypto'

import { larkPairCodes } from './agent-bot-store'

// ─── DM pair codes ───────────────────────────────────────────────────────────
// The alphabet omits vowels (and 0/1/I/L/O) so a code can never spell a word:
// a bare 6-char token in a DM is then unambiguously a pairing attempt, never a
// real message we'd hijack.
const PAIR_CODE_ALPHABET = 'BCDFGHJKMNPQRSTVWXYZ23456789'
const PAIR_CODE_LENGTH = 6
const PAIR_CODE_TTL_MS = 10 * 60 * 1000
const PAIR_CODE_RE = new RegExp(`^[${PAIR_CODE_ALPHABET}]{${String(PAIR_CODE_LENGTH)}}$`)

function generatePairCode(): string {
  let code = ''

  for (let i = 0; i < PAIR_CODE_LENGTH; i++)
    code += PAIR_CODE_ALPHABET.charAt(randomInt(PAIR_CODE_ALPHABET.length))

  return code
}

// Returns the canonical code if the input looks like one (case/dash/space
// tolerant), else null — lets the DM handler cheaply tell a code from a chat.
export function normalizeLarkPairCode(input: string): string | null {
  const stripped = input.trim().toUpperCase().replace(/[\s-]/g, '')

  return PAIR_CODE_RE.test(stripped) ? stripped : null
}

export async function createLarkPairCode(data: {
  teamId: string
  nuphosUserId: string
}): Promise<{ code: string; expiresAt: Date }> {
  // One live code per member: drop any prior one so the desktop only ever shows
  // the single code the DM handler will accept.
  await larkPairCodes().deleteMany({ teamId: data.teamId, nuphosUserId: data.nuphosUserId })
  const now = new Date()
  const expiresAt = new Date(now.getTime() + PAIR_CODE_TTL_MS)

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generatePairCode()

    try {
      await larkPairCodes().insertOne({
        code,
        teamId: data.teamId,
        nuphosUserId: data.nuphosUserId,
        createdAt: now,
        expiresAt,
      })

      return { code, expiresAt }
    } catch (err) {
      if ((err as { code?: number }).code === 11000) continue
      throw err
    }
  }
  throw new Error('Failed to allocate a unique Lark pair code')
}

// One-time redeem: delete on success so a leaked/shared code can't be replayed.
// Scoped by teamId so a code only binds inside the app it was generated for.
export async function consumeLarkPairCode(data: {
  code: string
  teamId: string
}): Promise<{ nuphosUserId: string } | null> {
  const doc = await larkPairCodes().findOneAndDelete({
    code: data.code,
    teamId: data.teamId,
    expiresAt: { $gt: new Date() },
  })

  return doc ? { nuphosUserId: doc.nuphosUserId } : null
}

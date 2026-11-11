import { AppError } from '@/lib/errors'

let active = false

/** Bound per-process archive memory, including uploads while they are being read. */
export async function withBotImportAdmission<T>(run: () => Promise<T>): Promise<T> {
  if (active)
    throw new AppError(429, 'import_busy', 'Another import is being processed. Try again shortly.')
  active = true
  try {
    return await run()
  } finally {
    active = false
  }
}

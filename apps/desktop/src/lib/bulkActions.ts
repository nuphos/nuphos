import { toast } from '../components/ui/toast'

export type BulkOutcome = { ok: number; failed: number }

/**
 * Run a per-item async action over a batch, settling all of them (one failure
 * never aborts the rest), and surface a single toast summary: success when all
 * pass, otherwise an error with the count and the first failure's message.
 *
 * `text` phrases the summary, e.g. { verbing: 'restart', verbed: 'Restarted',
 * noun: 'deployment' } → "Restarted 3 deployments" / "Failed to restart 2
 * deployments" / "Restarted 2 deployments, 1 failed".
 */
export async function runBulk<T>(
  items: T[],
  fn: (item: T) => Promise<unknown>,
  text: { verbing: string; verbed: string; noun: string },
): Promise<BulkOutcome> {
  const results = await Promise.allSettled(items.map((item) => fn(item)))
  const failed = results.filter((r) => r.status === 'rejected').length
  const ok = results.length - failed
  const noun = (n: number) => `${String(n)} ${text.noun}${n === 1 ? '' : 's'}`

  if (failed === 0) {
    toast.success(`${text.verbed} ${noun(ok)}`)
  } else {
    const firstError = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')

    // The count summary itself is the message — it must stay visible even when
    // the underlying failures are transport errors, so both sites use a
    // hand-authored fallback.
    if (ok === 0) {
      toast.apiError(`Failed to ${text.verbing} ${noun(failed)}`, firstError?.reason, {
        fallback: 'Check your connection and retry.',
      })
    } else {
      toast.apiError(`${text.verbed} ${noun(ok)}, ${String(failed)} failed`, firstError?.reason, {
        fallback: 'Retry the failed items.',
      })
    }
  }

  return { ok, failed }
}

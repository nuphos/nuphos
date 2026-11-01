import { toast } from '../components/ui/toast'
import { t } from '../i18n/index.ts'

export type BulkOutcome = { ok: number; failed: number }

/**
 * Run a per-item async action over a batch, settling all of them (one failure
 * never aborts the rest), and surface a single toast summary: success when all
 * pass, otherwise an error with the count and the first failure's message.
 *
 * `action` names the batch, e.g. t('Restart deployments') → "Restart
 * deployments: 3 done" / "…: 2 failed" / "…: 2 done, 1 failed". Counts follow
 * the label, so no language has to agree a noun with a number.
 */
export async function runBulk<T>(
  items: T[],
  fn: (item: T) => Promise<unknown>,
  action: string,
): Promise<BulkOutcome> {
  const results = await Promise.allSettled(items.map((item) => fn(item)))
  const failed = results.filter((r) => r.status === 'rejected').length
  const ok = results.length - failed

  if (failed === 0) {
    toast.success(t('{action}: {n} done', { action, n: ok }))
  } else {
    const firstError = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')

    // The count summary itself is the message — it must stay visible even when
    // the underlying failures are transport errors, so both sites use a
    // hand-authored fallback.
    if (ok === 0) {
      toast.apiError(t('{action}: {n} failed', { action, n: failed }), firstError?.reason, {
        fallback: t('Check your connection and retry.'),
      })
    } else {
      toast.apiError(
        t('{action}: {ok} done, {failed} failed', { action, ok, failed }),
        firstError?.reason,
        {
          fallback: t('Retry the failed items.'),
        },
      )
    }
  }

  return { ok, failed }
}

import { useEffect, useState } from 'react'

import { api } from '../../api'

import type { BoxSize, InstaboxAccount } from '../../api/device-types'

/** The team's own instabox accounts; empty until read, and when the read fails. */
export function useInstaboxAccounts(teamId: string): InstaboxAccount[] {
  const [accounts, setAccounts] = useState<InstaboxAccount[]>([])

  useEffect(() => {
    let cancelled = false

    void api.instaboxAccounts(teamId).then(
      (next) => !cancelled && setAccounts(next),
      () => !cancelled && setAccounts([]),
    )

    return () => {
      cancelled = true
    }
  }, [teamId])

  return accounts
}

/**
 * Which account a new Box goes on: Nuphos's (undefined) when this deployment offers Boxes,
 * else the team's first. A team account's sizes are its own: null while read, [] if that failed.
 */
export function useBoxAccount(teamId: string, accounts: InstaboxAccount[], deployment: boolean) {
  const [picked, setPicked] = useState<string>()
  const accountId = picked ?? (deployment ? undefined : accounts[0]?.id)
  const [sizes, setSizes] = useState<{ accountId: string; sizes: BoxSize[] } | null>(null)

  useEffect(() => {
    if (!accountId) return
    let cancelled = false

    void api.instaboxSizes(teamId, accountId).then(
      (next) => !cancelled && setSizes({ accountId, sizes: next }),
      () => !cancelled && setSizes({ accountId, sizes: [] }),
    )

    return () => {
      cancelled = true
    }
  }, [teamId, accountId])

  return {
    accounts,
    deployment,
    accountId,
    /** '' picks Nuphos's own account. */
    setAccountId: (id: string) => setPicked(id || undefined),
    sizes: accountId && sizes?.accountId === accountId ? sizes.sizes : null,
  }
}

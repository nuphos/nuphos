import { t } from '../../i18n/index.ts'

import type { LocalShareApproval } from '../../api/device-types'

/** What the owner's system notification says about one request to use their computer. */
export function shareApprovalNotice(
  approval: Pick<LocalShareApproval, 'deviceLabel' | 'title'>,
  requester: string | undefined,
): { title: string; body: string } {
  const answer = t('Open the Inbox to approve or decline.')

  return {
    title: t('{name} wants to run an agent on {device}', {
      name: requester ?? t('A teammate'),
      device: approval.deviceLabel,
    }),
    body: approval.title ? `“${approval.title}”\n${answer}` : answer,
  }
}

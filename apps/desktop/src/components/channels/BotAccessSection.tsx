import { Laptop, Lock, Shield, Unlock } from 'lucide-react'
import { useEffect, useRef } from 'react'

import { t } from '../../i18n'
import { takeBotAccessAsk, useBotAccessAsks } from '../../lib/botDetailsPanel'
import { BypassControlMenu } from '../agent/panel/composerMenus'
import { CredentialSelectorButton } from '../agent/panel/CredentialSelectorButton'
import { countSelectedCredentials } from '../agent/panel/credentialSelectorButtonCounts'
import { SummaryRow, SummarySection } from '../agent/summary/ChatSummaryRows'

import type { CredentialSelectorControl } from '../agent/panel/credentialSections'

/**
 * What a Bot may use, in its details: the same pickers and mode menu its chat's composer had,
 * each opening under its row. Only the owner changes them; anyone else reads them.
 */
export function BotAccessSection({
  credentials,
  bypassControl,
  owned,
}: {
  /** Undefined until the Bot's selection loads. */
  credentials: CredentialSelectorControl | undefined
  /** Undefined until the Bot's mode loads. */
  bypassControl?: { active: boolean | undefined; onSelect: (bypass: boolean) => void }
  owned: boolean
}) {
  const ref = useRef<HTMLElement>(null)
  const asks = useBotAccessAsks()

  // The chat's choose-access banner asked for this section, before or after it was drawn.
  useEffect(() => {
    if (credentials && takeBotAccessAsk()) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [asks, credentials])

  if (!credentials) return null

  return (
    <SummarySection ref={ref} title={t('Access')}>
      {owned ? (
        <>
          <CredentialSelectorButton {...credentials} hero={false} personalIdentity asRow />
          {bypassControl && <BypassControlMenu bypassControl={bypassControl} hero={false} asRow />}
        </>
      ) : (
        <>
          <SummaryRow
            icon={<Shield className="size-3.5" strokeWidth={1.8} />}
            label={t('Credentials')}
            note={
              credentials.value.allCredentials
                ? t('All')
                : countSelectedCredentials(credentials.value, credentials.options)
            }
          />
          <SummaryRow
            icon={<Laptop className="size-3.5" strokeWidth={1.8} />}
            label={t('Computers')}
            note={credentials.value.allDevices ? t('All') : credentials.value.deviceIds.length}
          />
          {bypassControl?.active !== undefined && (
            <SummaryRow
              icon={
                bypassControl.active ? (
                  <Unlock className="size-3.5" strokeWidth={1.8} />
                ) : (
                  <Lock className="size-3.5" strokeWidth={1.8} />
                )
              }
              label={bypassControl.active ? t('Full Access') : t('Auto Mode')}
            />
          )}
        </>
      )}
    </SummarySection>
  )
}

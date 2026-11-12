import { useState } from 'react'
import { encode } from 'uqr'

import { api } from '../../api'
import { CodeInput } from '../../components/CodeInput'
import { Button } from '../../components/ui/button'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'
import { CODE_LENGTH } from '../../lib/codeEntry'

import type { MfaSetup } from '../../types'

/** Adding the authenticator: scan or type the key, then prove it with a code. */
export function TotpSetup({
  setup,
  onEnabled,
  onCancel,
}: {
  setup: MfaSetup
  onEnabled: (recoveryCodes: string[]) => void
  onCancel: () => void
}) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)

  async function confirmSetup(value: string) {
    if (busy || value.length !== CODE_LENGTH) return
    setBusy(true)
    try {
      onEnabled(await api.atlasConfirmMfaSetup(value))
      toast.success(t('Two-factor authentication is on'))
    } catch (err) {
      toast.apiError(t('That code didn’t work'), err)
      setCode('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className={`rounded-lg border border-line-control/70 bg-surface px-4 py-3.5 flex flex-col gap-4`}
    >
      <div className="flex gap-5">
        <QrCode text={setup.otpauthUrl} />
        <div className="min-w-0 flex-1 text-[13px] leading-relaxed text-secondary">
          <p className="font-medium text-main">{t('1. Scan this with an authenticator app')}</p>
          <p className="mt-1">
            {t('Such as 1Password, Google Authenticator or Authy. Can’t scan it? Enter this key:')}
          </p>
          <p className="mt-2 select-all break-all font-mono text-[12.5px] text-main">
            {setup.secret.replace(/(.{4})/g, '$1 ').trim()}
          </p>
        </div>
      </div>
      <form
        className="flex flex-col gap-2.5"
        onSubmit={(e) => {
          e.preventDefault()
          void confirmSetup(code)
        }}
      >
        <p className="text-[13px] font-medium text-main">
          {t('2. Enter the 6-digit code it shows')}
        </p>
        <div className="max-w-[240px]">
          <CodeInput
            value={code}
            autoFocus
            onChange={(next) => {
              setCode(next)
              if (next.length === CODE_LENGTH && next !== code) void confirmSetup(next)
            }}
          />
        </div>
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={busy || code.length !== CODE_LENGTH}>
            {busy ? t('Verifying…') : t('Turn on')}
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={onCancel}>
            {t('Cancel')}
          </Button>
        </div>
      </form>
    </div>
  )
}

/** The otpauth:// link as a QR code, dark on white so any phone camera reads it. */
function QrCode({ text }: { text: string }) {
  const { size, data } = encode(text, { border: 2 })

  return (
    <svg
      viewBox={`0 0 ${String(size)} ${String(size)}`}
      className="h-[144px] w-[144px] shrink-0 rounded-md bg-white"
      shapeRendering="crispEdges"
      role="img"
      aria-label={t('QR code for your authenticator app')}
    >
      {data.flatMap((row, y) =>
        row.map((dark, x) =>
          dark ? <rect key={`${String(x)}-${String(y)}`} x={x} y={y} width={1} height={1} /> : null,
        ),
      )}
    </svg>
  )
}

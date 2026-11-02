import { useEffect, useState } from 'react'

import { api } from '../../api'
import { Button } from '../../components/ui/button'
import { useUpdaterState } from '../../components/useReadyUpdate'
import { t } from '../../i18n'

import { SectionHeader } from './shared'
import { updateProgress } from './updateProgress'

import type { UpdaterState } from '../../types'

function statusText(state: UpdaterState): string {
  switch (state.kind) {
    case 'idle':
      return ''
    case 'checking':
      return t('Checking for updates…')
    case 'up-to-date':
      return t("You're up to date.")
    case 'downloading':
      return t('Downloading Nuphos {version}…', { version: state.version })
    case 'ready':
      return t('Nuphos {version} is ready. Restart to finish updating.', {
        version: state.version,
      })
    case 'error':
      return t("Couldn't check for updates. Check your connection and try again.")
  }
}

export function UpdatesSection() {
  const state = useUpdaterState()
  const [version, setVersion] = useState('')
  const progress = state.kind === 'downloading' ? updateProgress(state) : null

  useEffect(() => {
    api
      .appGetVersion()
      .then(setVersion)
      .catch(() => null)
    // Opening the page is a request for fresh status; main skips the check
    // while an update is downloading or ready.
    void api.updaterCheck()
  }, [])

  return (
    <div>
      <SectionHeader
        title={t('Updates')}
        description={t('Nuphos downloads updates in the background.')}
      />
      <div className="rounded-lg border border-zGray-800 bg-surface p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[13px] font-medium text-main">Nuphos {version}</div>
            <p className="mt-1 min-h-[18px] text-[12px] text-tertiary" role="status">
              {statusText(state)}
            </p>
          </div>
          {state.kind === 'ready' ? (
            <Button onClick={() => void api.updaterInstall()}>{t('Restart')}</Button>
          ) : (
            state.kind !== 'downloading' && (
              <Button
                variant="secondary"
                disabled={state.kind === 'checking'}
                onClick={() => void api.updaterCheck()}
              >
                {t('Check for updates')}
              </Button>
            )
          )}
        </div>
        {progress && (
          <div className="mt-3">
            <div
              className="h-1.5 overflow-hidden rounded-full bg-zGray-800"
              role="progressbar"
              aria-valuenow={progress.percent}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="h-full rounded-full bg-zViolet-500 transition-[width] duration-700"
                style={{ width: `${String(progress.percent)}%` }}
              />
            </div>
            <p className="mt-1.5 text-[12px] tabular-nums text-tertiary">
              {t('{percent}% · {done} of {total} · {speed}/s', progress)}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

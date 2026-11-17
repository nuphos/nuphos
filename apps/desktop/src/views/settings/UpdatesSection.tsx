import { useEffect, useState } from 'react'

import { api } from '../../api'
import { Button } from '../../components/ui/button'
import { Switch } from '../../components/ui/Switch'
import { toast } from '../../components/ui/toast'
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
      return state.installerUrl
        ? t(
            "Nuphos {version} didn't install last time. Restart to try again, or download the installer.",
            {
              version: state.version,
            },
          )
        : t('Nuphos {version} is ready. Restart to finish updating.', { version: state.version })
    case 'error':
      return t("Couldn't check for updates. Check your connection and try again.")
  }
}

export function UpdatesSection() {
  const state = useUpdaterState()
  const [version, setVersion] = useState('')
  const progress = state.kind === 'downloading' ? updateProgress(state) : null
  const installerUrl = state.kind === 'ready' ? state.installerUrl : null
  const [autoInstall, setAutoInstall] = useState<boolean | null>(null)

  useEffect(() => {
    api
      .updaterGetAutoInstall()
      .then(({ enabled }) => setAutoInstall(enabled))
      .catch(() => null)
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
      <div className="rounded-lg border border-line-control bg-surface p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[13px] font-medium text-main">Nuphos {version}</div>
            <p className="mt-1 min-h-[18px] text-[12px] text-tertiary" role="status">
              {statusText(state)}
            </p>
          </div>
          {state.kind === 'ready' ? (
            <div className="flex shrink-0 gap-2">
              {installerUrl && (
                <Button variant="secondary" onClick={() => void api.appOpenExternal(installerUrl)}>
                  {t('Download installer')}
                </Button>
              )}
              <Button onClick={() => void api.updaterInstall()}>{t('Restart')}</Button>
            </div>
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
              className="h-1.5 overflow-hidden rounded-full bg-surface-sunken"
              role="progressbar"
              aria-valuenow={progress.percent}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="h-full rounded-full bg-action-primary transition-[width] duration-700"
                style={{ width: `${String(progress.percent)}%` }}
              />
            </div>
            <p className="mt-1.5 text-[12px] tabular-nums text-tertiary">
              {t('{percent}% · {done} of {total} · {speed}/s', progress)}
            </p>
          </div>
        )}
      </div>
      {autoInstall !== null && (
        <label className="mt-3 flex items-start justify-between gap-3 rounded-lg border border-line-control bg-surface p-4">
          <div>
            <div className="text-[13px] font-medium text-main">
              {t('Install updates automatically')}
            </div>
            <p className="mt-1 text-[12px] text-tertiary">
              {t(
                'When an update is ready, restart to install it after 10 minutes without keyboard or mouse input, while no agent task is running on this computer.',
              )}
            </p>
          </div>
          <Switch
            checked={autoInstall}
            onChange={(enabled) => {
              api
                .updaterSetAutoInstall(enabled)
                .then((next) => setAutoInstall(next.enabled))
                .catch((err: unknown) =>
                  toast.apiError(t('Could not change automatic updates'), err),
                )
            }}
          />
        </label>
      )}
    </div>
  )
}

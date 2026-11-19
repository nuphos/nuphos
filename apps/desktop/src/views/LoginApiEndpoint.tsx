import { useEffect, useState } from 'react'

import { api } from '../api'
import { Button } from '../components/ui/button'
import { toast } from '../components/ui/toast'
import { t } from '../i18n'
import { setAvatarApiOrigin } from '../lib/avatarUrl'

const DEFAULT_API_URL = 'https://api.nuphos.ai'
const EXAMPLE_URL = 'https://nuphos.example.com'

type Props = { inputClassName: string; onChange: () => void }

function isHttpUrl(raw: string) {
  try {
    return ['http:', 'https:'].includes(new URL(raw.trim()).protocol)
  } catch {
    return false
  }
}

/** The sign-in screen's quiet "self-hosted backend" switch. Takes effect immediately. */
export function LoginApiEndpoint({ inputClassName, onChange }: Props) {
  const [current, setCurrent] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')

  useEffect(() => {
    void api.atlasGetApiUrl().then(setCurrent)
  }, [])

  if (!current) return null
  const custom = current !== DEFAULT_API_URL

  async function save(url: string | null) {
    if (url !== null && !isHttpUrl(url)) {
      toast.error(
        t('Invalid API endpoint'),
        t('Enter a full URL, e.g. {url}', { url: EXAMPLE_URL }),
      )

      return
    }
    const next = await api.appSetApiEndpoint(url)

    setAvatarApiOrigin(next)
    setCurrent(next)
    setEditing(false)
    onChange()
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setValue(custom ? current : '')
          setEditing(true)
        }}
        className="mt-6 text-[12px] text-tertiary hover:text-secondary titlebar-no-drag"
      >
        {custom
          ? t('Server: {host} · Change', { host: new URL(current).host })
          : t('Self-hosted? Set API endpoint')}
      </button>
    )
  }

  return (
    <form
      className="mt-6 w-full flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        void save(value)
      }}
    >
      <input
        type="url"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={EXAMPLE_URL}
        autoFocus
        className={inputClassName}
      />
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={!value.trim()} className="titlebar-no-drag">
          {t('Save')}
        </Button>
        {custom && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void save(null)}
            className="titlebar-no-drag"
          >
            {t('Use Nuphos Cloud')}
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setEditing(false)}
          className="ml-auto titlebar-no-drag"
        >
          {t('Cancel')}
        </Button>
      </div>
    </form>
  )
}

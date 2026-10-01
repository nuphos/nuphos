import { useState } from 'react'

import { api } from '../../api'
import { Avatar } from '../../components/Avatar'
import { Button } from '../../components/ui/button'
import { trustedAvatarURL } from '../../lib/avatarUrl'

import { Field, SectionHeader } from './shared'
import { inputClasses } from './styles'

import type { UserInfo } from '../../types'
import type { FormEvent } from 'react'

export function ProfileSection({
  user,
  onSignOut,
  onUserUpdated,
}: {
  user: UserInfo
  onSignOut: () => void
  onUserUpdated: (user: UserInfo) => void
}) {
  const [name, setName] = useState(user.name)
  const [username, setUsername] = useState(user.username)
  const [avatarURL, setAvatarURL] = useState(user.avatarURL ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const dirty =
    name !== user.name || username !== user.username || avatarURL !== (user.avatarURL ?? '')

  async function save(event: FormEvent) {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const next = await api.authUpdateProfile({
        name: name.trim(),
        username: username.trim(),
        avatarURL: avatarURL.trim(),
      })

      onUserUpdated(next)
      setName(next.name)
      setUsername(next.username)
      setAvatarURL(next.avatarURL ?? '')
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save profile')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <SectionHeader
        title="Profile"
        description="Your account, shared across every team you belong to."
      />
      <form onSubmit={(event) => void save(event)} className="space-y-5">
        <Avatar
          src={trustedAvatarURL(avatarURL)}
          name={name || username}
          size={56}
          className="rounded-full !shadow-none"
        />
        <fieldset disabled={saving} className="space-y-4">
          <Field label="Name">
            <input
              className={inputClasses}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={100}
              autoComplete="name"
            />
          </Field>
          <Field label="Username" hint="Letters, numbers, underscores and hyphens.">
            <input
              className={inputClasses}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              minLength={1}
              maxLength={40}
              pattern="[a-zA-Z0-9_-]+"
              autoComplete="username"
            />
          </Field>
          <Field
            label="Avatar URL"
            hint="Use your Google profile-image URL, or leave blank for your initials."
          >
            <input
              className={inputClasses}
              type="url"
              value={avatarURL}
              onChange={(e) => setAvatarURL(e.target.value)}
              maxLength={2048}
              placeholder="https://lh3.googleusercontent.com/…"
            />
          </Field>
          <Field label="Email" hint="Your sign-in email cannot be changed here.">
            <input className={inputClasses} value={user.email} readOnly />
          </Field>
        </fieldset>
        {error && (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        )}
        {saved && !dirty && (
          <p role="status" className="text-sm text-secondary">
            Profile saved.
          </p>
        )}
        <Button type="submit" size="sm" disabled={saving || !dirty}>
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
      </form>
      <div className="mt-6 flex items-center justify-between rounded-lg border border-zGray-800/70 bg-surface px-4 py-3.5">
        <div className="text-[13px] text-secondary">Log out of Nuphos on this computer.</div>
        <Button type="button" size="sm" variant="secondary" onClick={onSignOut} disabled={saving}>
          Log out
        </Button>
      </div>
    </div>
  )
}

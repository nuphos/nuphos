import { useState } from 'react'

/** noVNC's credentials; `target` is only for XVP, which a Mac does not use. */
export type MacAccount = { username: string; password: string; target: '' }

const FIELD =
  'h-8 rounded-md border border-zGray-700 bg-field px-2 text-[13px] text-main placeholder:text-tertiary focus:outline-none focus:ring-1 focus:ring-zViolet-500'

/** A Mac's Screen Sharing asks for an account on that Mac before it shows the screen. */
export function MacSignIn({
  failed,
  onSubmit,
}: {
  failed: boolean
  onSubmit: (account: MacAccount) => void
}) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  return (
    <form
      className="flex w-64 flex-col gap-2 text-xs text-secondary"
      onSubmit={(event) => {
        event.preventDefault()
        if (username && password) onSubmit({ username, password, target: '' })
      }}
    >
      <span className="text-sm text-main">Sign in to this Mac</span>
      <span>
        {failed
          ? 'That account was not accepted. Try again.'
          : 'Use an account on the Mac to see its screen.'}
      </span>
      <input
        aria-label="Mac account name"
        autoComplete="username"
        value={username}
        onChange={(event) => setUsername(event.target.value)}
        placeholder="Account name"
        className={FIELD}
      />
      <input
        aria-label="Mac password"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        placeholder="Password"
        className={FIELD}
      />
      <button
        type="submit"
        disabled={!username || !password}
        className="rounded border border-zGray-700 px-2 py-1 text-main hover:bg-zGray-800 disabled:opacity-50"
      >
        Sign in
      </button>
    </form>
  )
}

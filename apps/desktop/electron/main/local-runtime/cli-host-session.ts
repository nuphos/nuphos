/** What `nuphos login` leaves in cli.yaml: the token, or the keychain item holding it. */
export type CliConfig = { token?: string; keychainAccount?: string } | null

/**
 * The CLI's session: the token in cli.yaml, or the launch token while cli.yaml
 * still names the keychain item the CLI read it from. Tokens are opaque here:
 * a device-login or agent token (`nup_…`) is not a JWT.
 */
export function cliSessionToken(
  cfg: CliConfig,
  launch: { token: string | null; keychainAccount: string | undefined },
): string | null {
  if (cfg?.token) return cfg.token

  return launch.token && cfg?.keychainAccount && cfg.keychainAccount === launch.keychainAccount
    ? launch.token
    : null
}

/** Whose agents this host runs, from `/auth/me`; an agent token may not run a computer. */
export function hostOwner(
  me: { id?: unknown; cliToken?: { kind?: unknown } } | null,
): { userId: string } | { error: string } {
  if (me?.cliToken?.kind === 'agent') {
    return {
      error:
        "An agent token cannot run this computer's agents. Sign in as yourself (`nuphos login --device`, then Approve as me), or join with `nuphos agent --join <token>`.",
    }
  }

  return typeof me?.id === 'string' && me.id
    ? { userId: me.id }
    : { error: 'Not signed in; run `nuphos login`, or join with `nuphos agent --join <token>`.' }
}

# Nuphos Tailscale database dialer

This rootless companion gives the Nuphos backend a loopback SOCKS5 path into a
team's tailnet. It does not receive database connection strings, database
credentials, queries, results, or Agent context.

The backend authenticates to the loopback control API and supplies a selected
team-scoped Tailscale OAuth client secret plus an advertised tag. The dialer
creates an isolated ephemeral `tsnet` identity per team and binding. Idle
identities are closed and their state directories are removed.

## Configuration

- `NUPHOS_TAILSCALE_DIALER_TOKEN` (required): high-entropy bearer token shared
  only with the backend process.
- `NUPHOS_TAILSCALE_DIALER_ADDR` (default `127.0.0.1:4141`): loopback listen
  address for the control API.
- `NUPHOS_TAILSCALE_STATE_DIR` (default `$TMPDIR/nuphos-tsnet`): parent for
  short-lived identity state directories.
- `NUPHOS_TAILSCALE_IDLE_TTL` (default `15m`, allowed `1m` to `24h`): idle
  identity lifetime.

The backend container wrapper derives the listen address from
`DATABASE_TAILSCALE_DIALER_URL`; operators normally only configure the backend
URL and shared token.

The OAuth client must be permitted to create auth keys for the configured tag,
and tailnet ACL grants for that tag remain the final network authorization
boundary.

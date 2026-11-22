import * as atlas from '../atlas'

/** Linode and Hetzner accounts. */
export const vpsChannels = {
  'atlas:listLinodeAccounts': (_e: unknown, teamId: string) => atlas.listLinodeAccounts(teamId),
  'atlas:bindLinodeAccount': (
    _e: unknown,
    teamId: string,
    label: string,
    token: string,
    share?: atlas.BindingShare,
  ) => atlas.bindLinodeAccount(teamId, label, token, share),
  'atlas:unbindLinodeAccount': (_e: unknown, teamId: string, accountId: string) =>
    atlas.unbindLinodeAccount(teamId, accountId),
  'atlas:listHetznerAccounts': (_e: unknown, teamId: string) => atlas.listHetznerAccounts(teamId),
  'atlas:bindHetznerAccount': (
    _e: unknown,
    teamId: string,
    label: string,
    token: string,
    share?: atlas.BindingShare,
  ) => atlas.bindHetznerAccount(teamId, label, token, share),
  'atlas:unbindHetznerAccount': (_e: unknown, teamId: string, accountId: string) =>
    atlas.unbindHetznerAccount(teamId, accountId),
  'atlas:listHetznerServers': (_e: unknown, teamId: string, accountId: string) =>
    atlas.listHetznerServers(teamId, accountId),
} as const

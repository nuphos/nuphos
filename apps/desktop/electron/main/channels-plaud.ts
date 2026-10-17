import * as atlas from '../atlas'
import * as plaudInstall from '../plaud-install'

export const plaudChannels = {
  'atlas:listPlaudAccounts': (_e: unknown, teamId: string) => atlas.listPlaudAccounts(teamId),
  'atlas:startPlaudOAuth': (_e: unknown, teamId: string) => plaudInstall.startInstall(teamId),
  'atlas:cancelPlaudOAuth': (_e: unknown, teamId: string) => plaudInstall.cancelPending(teamId),
  'atlas:unbindPlaud': (_e: unknown, teamId: string, bindingId: string) =>
    atlas.unbindPlaud(teamId, bindingId),
  'atlas:getPlaudAccountAccess': (_e: unknown, teamId: string, bindingId: string) =>
    atlas.getPlaudAccountAccess(teamId, bindingId),
  'atlas:updatePlaudAccountAccess': (
    _e: unknown,
    teamId: string,
    bindingId: string,
    access: Pick<atlas.BindingAccess, 'memberAllowList'>,
  ) => atlas.updatePlaudAccountAccess(teamId, bindingId, access),
} as const

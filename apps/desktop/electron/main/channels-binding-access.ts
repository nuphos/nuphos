import * as atlas from '../atlas'

export const bindingAccessChannels = {
  'atlas:getBindingAccess': (_e: unknown, teamId: string, collection: string, bindingId: string) =>
    atlas.getBindingAccess(teamId, collection, bindingId),
  'atlas:updateBindingAccess': (
    _e: unknown,
    teamId: string,
    collection: string,
    bindingId: string,
    access: Pick<atlas.BindingAccess, 'memberAllowList'>,
  ) => atlas.updateBindingAccess(teamId, collection, bindingId, access),
} as const

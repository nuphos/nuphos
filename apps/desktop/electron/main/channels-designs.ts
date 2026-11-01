import * as atlas from '../atlas'

// Design canvases: the list, the stamp a canvas polls, and its writes.
export const designChannels = {
  'designs:list': (_e: unknown, teamId: string) => atlas.designsList(teamId),
  'designs:stamp': (_e: unknown, teamId: string, designId: string) =>
    atlas.designsStamp(teamId, designId),
  'designs:get': (_e: unknown, teamId: string, designId: string) =>
    atlas.designsGet(teamId, designId),
  'designs:create': (_e: unknown, teamId: string, input: unknown) =>
    atlas.designsCreate(teamId, input),
  'designs:replace': (_e: unknown, teamId: string, designId: string, patch: unknown) =>
    atlas.designsReplace(teamId, designId, patch),
  'designs:applyOps': (_e: unknown, teamId: string, designId: string, ops: unknown) =>
    atlas.designsApplyOps(teamId, designId, ops),
  'designs:delete': (_e: unknown, teamId: string, designId: string) =>
    atlas.designsDelete(teamId, designId),
}

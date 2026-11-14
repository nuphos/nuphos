import * as atlas from '../atlas'

import { approveLinkedSkill } from './local-setup-snapshot'
import { readTeam, stateKey } from './local-setup-state'
import { localSetupStatus, syncLocalSetup, syncLocalSetupAfter } from './local-setup-sync'
import { setLocalSetupAutoSync, setLocalSetupFolders } from './local-setup-watch'
import { importLocalSkills } from './local-skill-import'
import { listLocalSkills } from './local-skills'

import type { LocalSkillImportPick } from './local-skill-import'
import type { LocalSkillReviewedFile } from './local-skills'
import type { SkillScope } from '../atlas'

// `scope` selects the team store (default) or the caller's personal skills.
export const skillChannels = {
  'teamSkills:getManifest': (_e: unknown, teamId: string, scope?: SkillScope) =>
    atlas.teamSkillsGetManifest(teamId, scope),
  'teamSkills:listObjects': (_e: unknown, teamId: string, scope?: SkillScope) =>
    atlas.teamSkillsListObjects(teamId, scope),
  'teamSkills:getObject': (_e: unknown, teamId: string, key: string, scope?: SkillScope) =>
    atlas.teamSkillsGetObject(teamId, key, scope),
  'teamSkills:getHistory': (_e: unknown, teamId: string, name: string, scope?: SkillScope) =>
    atlas.teamSkillsGetHistory(teamId, name, scope),
  'teamSkills:putObject': (
    _e: unknown,
    teamId: string,
    key: string,
    file: { filename: string; bytes: Uint8Array; contentType?: string },
    scope?: SkillScope,
  ) => atlas.teamSkillsPutObject(teamId, key, file, scope),
  'teamSkills:listLocal': () => listLocalSkills(),
  'teamSkills:importLocal': (
    _e: unknown,
    teamId: string,
    scope: SkillScope | undefined,
    picks: LocalSkillImportPick[],
  ) => importLocalSkills(teamId, scope, picks),
  'teamSkills:deleteObject': (_e: unknown, teamId: string, key: string, scope?: SkillScope) =>
    atlas.teamSkillsDeleteObject(teamId, key, scope),
  'teamSkills:deleteSkill': (_e: unknown, teamId: string, name: string, scope?: SkillScope) =>
    atlas.teamSkillsDeleteSkill(teamId, name, scope),
  'teamSkills:githubPreview': (_e: unknown, teamId: string, source: string, scope?: SkillScope) =>
    atlas.teamSkillsGithubPreview(teamId, source, scope),
  'teamSkills:githubInstall': (
    _e: unknown,
    teamId: string,
    input: { source: string; commitSha: string; names: string[] },
    scope?: SkillScope,
  ) => atlas.teamSkillsGithubInstall(teamId, input, scope),
  'teamSkills:githubUpdates': (_e: unknown, teamId: string, scope?: SkillScope) =>
    atlas.teamSkillsGithubUpdates(teamId, scope),
  'teamSkills:githubUpdate': (
    _e: unknown,
    teamId: string,
    input: { names: string[]; overwriteEdited: string[]; commits: Record<string, string> },
    scope?: SkillScope,
  ) => atlas.teamSkillsGithubUpdate(teamId, input, scope),
  'teamSkills:promote': (_e: unknown, teamId: string, name: string) =>
    atlas.teamSkillsPromote(teamId, name),
  'localSetup:status': (_e: unknown, teamId: string) => localSetupStatus(teamId),
  'localSetup:sync': (_e: unknown, teamId: string) => syncLocalSetup(teamId),
  'localSetup:approveLinks': async (
    _e: unknown,
    teamId: string,
    name: string,
    reviewed: LocalSkillReviewedFile[],
  ) => {
    // A pass already running read the skill before this approval, so run a new one.
    await approveLinkedSkill(teamId, name, reviewed)

    return syncLocalSetupAfter(teamId)
  },
  'localSetup:setAutoSync': (_e: unknown, teamId: string, enabled: boolean) =>
    setLocalSetupAutoSync(teamId, enabled),
  'localSetup:setFolders': (_e: unknown, teamId: string, folders: string[]) =>
    setLocalSetupFolders(teamId, folders),
  // The folder each synced skill came from, as of the last pass: no disk walk.
  'localSetup:sources': async (_e: unknown, teamId: string) =>
    readTeam(await stateKey(teamId)).sources ?? {},
}

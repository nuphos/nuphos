import * as atlas from '../atlas'

import { importLocalSkill } from './local-skill-import'
import { listLocalSkills } from './local-skills'

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
  'teamSkills:importLocal': (_e: unknown, teamId: string, skillId: string, scope?: SkillScope) =>
    importLocalSkill(teamId, skillId, scope),
  'teamSkills:deleteObject': (_e: unknown, teamId: string, key: string, scope?: SkillScope) =>
    atlas.teamSkillsDeleteObject(teamId, key, scope),
  'teamSkills:deleteSkill': (_e: unknown, teamId: string, name: string, scope?: SkillScope) =>
    atlas.teamSkillsDeleteSkill(teamId, name, scope),
  'teamSkills:promote': (_e: unknown, teamId: string, name: string) =>
    atlas.teamSkillsPromote(teamId, name),
}

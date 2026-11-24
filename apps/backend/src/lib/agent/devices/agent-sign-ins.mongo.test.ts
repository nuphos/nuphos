// Who signed a computer's agents in, against a real MongoDB: it outlives forgetting the
// computer, a late check ends only the sign-in it checked, and its owner's own CLI sign-in
// replaces it.
// Runs when TEST_MONGODB_URI is set, with MONGODB_URI pointing at the same server.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { closeDb, connectDb, db } from '@/lib/db'

import { endAgentSignIn, forgetOwnSignIn, recordAgentSignIn } from './agent-sign-ins'
import {
  agentDevices,
  deleteAgentDevice,
  findGrantedDevices,
  getAgentDevice,
  listAgentDevicesForUser,
  listDevicesGrantedInTeam,
  upsertAgentDevice,
} from './store'

const OWNER = new ObjectId().toHexString()
const TEAM = new ObjectId().toHexString()
const at = new Date('2026-11-13T00:00:00Z')
const registration = {
  label: 'Mac',
  platform: 'darwin',
  allowLocalExec: true,
}
const noReset = () => Promise.resolve({ state: 'done' as const })

describe.skipIf(!process.env.TEST_MONGODB_URI)('who signed a computer’s agents in', () => {
  beforeAll(async () => {
    await connectDb()
  })

  afterAll(async () => {
    await agentDevices().deleteMany({ userId: OWNER })
    await db().collection('agent_devices_forgotten').deleteMany({ userId: OWNER })
    await closeDb()
  })

  test('forgetting a computer keeps its ended sign-ins and pending resets until it registers again', async () => {
    const deviceId = new ObjectId().toHexString()
    const ref = { userId: OWNER, deviceId }
    const reset = { id: 'r1', agent: { instanceId: 'i1' }, actorId: 'lead', teamId: TEAM, at }

    await upsertAgentDevice(OWNER, { ...registration, deviceId })
    await agentDevices().updateOne(ref, {
      $set: {
        access: [{ teamId: TEAM, everyone: true, userIds: [], managerIds: [] }],
        signIns: [{ agent: 'claude-code', userId: 'lead', teamId: TEAM, at, endedAt: at }],
        pendingResets: [reset],
      },
    })

    expect(await deleteAgentDevice(OWNER, deviceId)).toBe(true)
    // Forgotten: nothing finds or lists it.
    expect(await getAgentDevice(OWNER, deviceId)).toBeNull()
    expect(await listAgentDevicesForUser(OWNER)).toEqual([])
    expect(await listDevicesGrantedInTeam(TEAM)).toEqual([])
    expect(await findGrantedDevices(TEAM, deviceId)).toEqual([])
    expect(await agentDevices().countDocuments(ref)).toBe(0)

    await upsertAgentDevice(OWNER, { ...registration, deviceId })
    const back = await getAgentDevice(OWNER, deviceId)

    expect(back?.signIns).toEqual([
      { agent: 'claude-code', userId: 'lead', teamId: TEAM, at, endedAt: at },
    ])
    expect(back?.pendingResets).toEqual([reset])
    // It did not come back with its grants.
    expect(back?.access).toBeUndefined()
    // Forgotten again with nothing to keep, it registers again with nothing.
    await agentDevices().updateOne(ref, { $unset: { signIns: '', pendingResets: '' } })
    await deleteAgentDevice(OWNER, deviceId)
    await upsertAgentDevice(OWNER, { ...registration, deviceId })
    expect((await getAgentDevice(OWNER, deviceId))?.signIns).toBeUndefined()
  })

  test('a late check ends only the sign-in it checked, not a newer one from another team', async () => {
    const deviceId = new ObjectId().toHexString()
    const ref = { userId: OWNER, deviceId }
    const agent = { provider: 'claude-code' as const }
    const checked = { userId: 'lead', teamId: TEAM, at }
    const newer = { userId: 'lead', teamId: 'other-team', at: new Date(at.getTime() + 1000) }

    await upsertAgentDevice(OWNER, { ...registration, deviceId })
    expect(await recordAgentSignIn(ref, agent, checked)).toBe(true)
    expect(await recordAgentSignIn(ref, agent, newer)).toBe(true)
    // The check of the first sign-in finishes only now, after the second was recorded.
    await endAgentSignIn(ref, agent, checked, noReset)

    expect((await getAgentDevice(OWNER, deviceId))?.signIns).toEqual([
      { agent: 'claude-code', ...newer },
    ])
  })

  test('its owner signing its default agent in with the CLI here replaces the earlier signer', async () => {
    const deviceId = new ObjectId().toHexString()
    const ref = { userId: OWNER, deviceId }
    const manager = { userId: 'manager', teamId: TEAM, at }

    await upsertAgentDevice(OWNER, { ...registration, deviceId })
    await recordAgentSignIn(ref, { provider: 'claude-code' }, manager)
    await recordAgentSignIn(ref, { provider: 'codex' }, manager)

    expect(await forgetOwnSignIn(OWNER, deviceId, 'claude-code')).toBe(true)
    expect((await getAgentDevice(OWNER, deviceId))?.signIns).toEqual([
      { agent: 'codex', ...manager },
    ])
    // A Box's agents are not its owner's CLI login.
    await agentDevices().updateOne(ref, { $set: { box: { provider: 'instabox', teamId: TEAM } } })
    expect(await forgetOwnSignIn(OWNER, deviceId, 'codex')).toBe(false)
    expect(await forgetOwnSignIn('someone-else', deviceId, 'codex')).toBe(false)
  })
})

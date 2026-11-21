import { beforeEach, expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'
import { portabilityDb } from '@/lib/test/runtime-portability-db'

import { migrateTeamPlanApprovalPolicies } from './retire'

import type * as dbActual from '@/lib/db'

let memory = portabilityDb()

useDb({ db: (() => memory) as unknown as typeof dbActual.db })

const minimums = async () =>
  Object.fromEntries(
    (await memory.collection('database_connections').find({}).toArray()).map((row) => [
      row._id,
      row.changeApprovalPolicy?.minimumApprovals,
    ]),
  )

beforeEach(async () => {
  memory = portabilityDb()
  const connections = memory.collection('database_connections')
  const policy = (minimumApprovals: number) => ({
    minimumApprovals,
    version: 4,
    updatedAt: new Date(0),
    updatedBy: 'admin',
  })

  await connections.insertOne({ _id: 'unset', teamId: 'team-a' })
  await connections.insertOne({ _id: 'lower', teamId: 'team-a', changeApprovalPolicy: policy(1) })
  await connections.insertOne({ _id: 'higher', teamId: 'team-a', changeApprovalPolicy: policy(3) })
  await connections.insertOne({
    _id: 'other-team',
    teamId: 'team-b',
    changeApprovalPolicy: policy(1),
  })
  await connections.insertOne({ _id: 'no-policy', teamId: 'team-c' })
  await memory
    .collection('plan_approval_policies')
    .insertOne({ _id: 'team-a', minimumOtherApprovals: 2, updatedBy: 'team-admin' })
  await memory
    .collection('plan_approval_policies')
    .insertOne({ _id: 'team-b', minimumOtherApprovals: 0, updatedBy: 'team-admin' })
})

test('each connection keeps the larger of its own and its team minimum', async () => {
  expect(await migrateTeamPlanApprovalPolicies()).toBe(2)
  expect(await minimums()).toEqual({
    unset: 2,
    lower: 2,
    higher: 3,
    'other-team': 1,
    'no-policy': undefined,
  })
  const lower = await memory.collection('database_connections').findOne({ _id: 'lower' })

  expect(lower?.changeApprovalPolicy).toMatchObject({ version: 4, updatedBy: 'team-admin' })
})

test('a second run changes nothing', async () => {
  await migrateTeamPlanApprovalPolicies()
  const first = await minimums()

  expect(await migrateTeamPlanApprovalPolicies()).toBe(0)
  expect(await minimums()).toEqual(first)
})

test('a policy an admin lowers after the migration stays lowered', async () => {
  await migrateTeamPlanApprovalPolicies()
  await memory
    .collection('database_connections')
    .updateOne({ _id: 'unset' }, { $set: { 'changeApprovalPolicy.minimumApprovals': 0 } })

  expect(await migrateTeamPlanApprovalPolicies()).toBe(0)
  expect((await minimums()).unset).toBe(0)
})

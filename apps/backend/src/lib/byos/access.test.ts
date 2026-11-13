import { describe, expect, test } from 'bun:test'

import {
  canUseAllowList,
  canUseBinding,
  createBinderOnlyAccess,
  createDefaultAccess,
  isPrivateAccess,
} from './access'

describe('createBinderOnlyAccess', () => {
  test('starts closed — only the binder, not the whole team', () => {
    const access = createBinderOnlyAccess('user-1')

    expect(access.memberAllowList).toEqual(['user-1'])
    expect(access.updatedBy).toBe('user-1')
  })

  test('records the binder as the owner and leaves admins out', () => {
    expect(createBinderOnlyAccess('user-1')).toMatchObject({
      memberAllowList: ['user-1'],
      ownerUserId: 'user-1',
    })
  })

  test('the binder can use the binding, a teammate cannot', () => {
    const { memberAllowList } = createBinderOnlyAccess('user-1')

    expect(canUseAllowList(memberAllowList, 'user-1')).toBe(true)
    expect(canUseAllowList(memberAllowList, 'user-2')).toBe(false)
  })

  test('contrasts with createDefaultAccess, which opens to every member', () => {
    expect(createDefaultAccess('user-1').memberAllowList).toEqual(['*'])
    expect(canUseAllowList(createDefaultAccess('user-1').memberAllowList, 'user-2')).toBe(true)
  })
})

const access = (memberAllowList: string[], ownerUserId?: string) => ({
  memberAllowList,
  ...(ownerUserId ? { ownerUserId } : {}),
  updatedAt: new Date(),
  updatedBy: 'admin',
})

describe('isPrivateAccess', () => {
  test('a list of only the owner is private, a list shared beyond them is not', () => {
    expect(isPrivateAccess(access(['u1'], 'u1'))).toBe(true)
    expect(isPrivateAccess(access(['u1', 'u2'], 'u1'))).toBe(false)
    expect(isPrivateAccess(access(['*'], 'u1'))).toBe(false)
  })

  test('without an owner, a list of at most one member is private', () => {
    expect(isPrivateAccess(undefined)).toBe(false)
    expect(isPrivateAccess(access(['u1']))).toBe(true)
    expect(isPrivateAccess(access([]))).toBe(true)
    expect(isPrivateAccess(access(['u1', 'u2']))).toBe(false)
  })
})

describe('canUseBinding', () => {
  test('admins may use bindings shared with the team or specific people', () => {
    expect(canUseBinding(access(['*']), 'admin', 'ADMINISTRATOR')).toBe(true)
    expect(canUseBinding(access(['u1', 'u2'], 'u1'), 'admin', 'ADMINISTRATOR')).toBe(true)
  })

  test("admins may not use another member's private binding", () => {
    expect(canUseBinding(access(['u1'], 'u1'), 'admin', 'ADMINISTRATOR')).toBe(false)
    expect(canUseBinding(access(['u1']), 'admin', 'ADMINISTRATOR')).toBe(false)
  })

  test('other roles need to be on the list', () => {
    expect(canUseBinding(access(['u1', 'u2'], 'u1'), 'u3', 'EDITOR')).toBe(false)
    expect(canUseBinding(access(['u1', 'u2'], 'u1'), 'u2', 'VIEWER')).toBe(true)
  })
})

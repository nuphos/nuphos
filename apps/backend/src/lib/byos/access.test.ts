import { describe, expect, test } from 'bun:test'

import { canUseAllowList, createBinderOnlyAccess, createDefaultAccess } from './access'

describe('createBinderOnlyAccess', () => {
  test('starts closed — only the binder, not the whole team', () => {
    const access = createBinderOnlyAccess('user-1')

    expect(access.memberAllowList).toEqual(['user-1'])
    expect(access.updatedBy).toBe('user-1')
  })

  test('does not bake admins into the list (roles change; the gate grants them)', () => {
    // A frozen admin list would both miss admins promoted later and keep access
    // for admins demoted since — hence binder-only here, admin grant at the gate.
    expect(createBinderOnlyAccess('user-1').memberAllowList).toEqual(['user-1'])
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

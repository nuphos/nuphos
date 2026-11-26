import { allCredentialAccess } from './credentialAccess.ts'
import { usableDeviceIds } from './credentialSections.ts'

import type { AgentCredentialOptions, AgentCredentialSelection } from '../../../api'

export type AllFlag = 'allCredentials' | 'allDevices'

/** A selection as the picker draws it: under "All", every row reads ticked, added-later ones too. */
export function expandAll(
  value: AgentCredentialSelection,
  options: AgentCredentialOptions,
): AgentCredentialSelection {
  if (!value.allCredentials && !value.allDevices) return value
  const { deviceIds: _devices, ...credentials } = allCredentialAccess(options)

  return {
    ...value,
    ...(value.allCredentials ? credentials : {}),
    ...(value.allDevices ? { deviceIds: usableDeviceIds(options.devices) } : {}),
  }
}

/** Turn "All" on or off. Off keeps what it covered now, ticked, but stops following new ones. */
export function setAll(
  value: AgentCredentialSelection,
  options: AgentCredentialOptions,
  flag: AllFlag,
  on: boolean,
): AgentCredentialSelection {
  const { [flag]: _flag, ...rest } = expandAll({ ...value, [flag]: true }, options)

  return on ? { ...rest, [flag]: true } : rest
}

/** Any other change to the picker is a hand-picked selection, so it leaves "All". */
export function withoutAll(value: AgentCredentialSelection, flag: AllFlag) {
  const { [flag]: _flag, ...rest } = value

  return rest
}

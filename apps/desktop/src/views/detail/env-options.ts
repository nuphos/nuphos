import { t } from '../../i18n/index.ts'

import type { AppSelectOption } from '../../components/ui/select'
import type {
  ConfigMapItem,
  DeploymentEnvFromInput,
  DeploymentEnvSource,
  SecretItem,
} from '../../types'

export const envInputClass =
  'h-8 w-full min-w-0 rounded border border-zGray-700 bg-zGray-950 px-2 font-mono text-[12px] text-main outline-none focus:border-zViolet-500'
export const envSelectTriggerClass = 'h-8 rounded px-2 text-[12px] focus:border-zViolet-500'
export const envMonoSelectTriggerClass =
  'h-8 rounded px-2 font-mono text-[12px] focus:border-zViolet-500'
export const envCheckboxClass = 'h-4 w-4 rounded border-zGray-700 bg-zGray-950 accent-zViolet-500'

export const envSourceOptions: AppSelectOption[] = [
  { value: 'value', label: t('Value') },
  { value: 'configMapKeyRef', label: t('ConfigMap key') },
  { value: 'secretKeyRef', label: t('Secret key') },
  { value: 'fieldRef', label: t('Field') },
  { value: 'resourceFieldRef', label: t('Resource') },
]

export const envFromSourceOptions: AppSelectOption[] = [
  { value: 'configMapRef', label: 'ConfigMap' },
  { value: 'secretRef', label: 'Secret' },
]

export function sourceLabel(source: DeploymentEnvSource | DeploymentEnvFromInput['source']) {
  switch (source) {
    case 'value':
      return t('Value')
    case 'configMapKeyRef':
      return t('ConfigMap key')
    case 'secretKeyRef':
      return t('Secret key')
    case 'fieldRef':
      return t('Field')
    case 'resourceFieldRef':
      return t('Resource')
    case 'fileKeyRef':
      return t('File key')
    case 'configMapRef':
      return 'ConfigMap'
    case 'secretRef':
      return 'Secret'
    case 'unknown':
      return t('Reference')
    default:
      return t('Reference')
  }
}

export function optionValues(values: (string | null | undefined)[], current?: string | null) {
  const seen = new Set<string>()
  const result: string[] = []

  for (const value of [...values, current]) {
    const normalized = (value ?? '').trim()

    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    result.push(normalized)
  }

  return result
}

export function selectOptions(values: string[]): AppSelectOption[] {
  return values.map((value) => ({ value, label: value }))
}

export function refNamesForSource(
  source: DeploymentEnvSource | DeploymentEnvFromInput['source'],
  configMaps: ConfigMapItem[],
  secrets: SecretItem[],
) {
  if (source === 'configMapKeyRef' || source === 'configMapRef') {
    return configMaps.map((item) => item.name)
  }
  if (source === 'secretKeyRef' || source === 'secretRef') {
    return secrets.map((item) => item.name)
  }

  return []
}

export function keyNamesForRef(
  source: DeploymentEnvSource,
  refName: string | null | undefined,
  configMaps: ConfigMapItem[],
  secrets: SecretItem[],
) {
  const name = (refName ?? '').trim()

  if (!name) return []
  if (source === 'configMapKeyRef') {
    return configMaps.find((item) => item.name === name)?.keyNames ?? []
  }
  if (source === 'secretKeyRef') {
    return secrets.find((item) => item.name === name)?.keyNames ?? []
  }

  return []
}

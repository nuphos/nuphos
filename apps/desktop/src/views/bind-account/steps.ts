import { t } from '../../i18n/index.ts'

export const VOLC_STEPS = [
  t('Add the identity provider'),
  t('Create the role'),
  t('Authorize cluster access (optional)'),
  t('Bind the role'),
] as const

export const HUAWEI_STEPS = [
  t('Add the identity provider'),
  t('Create a trust agency'),
  t('Bind the account'),
] as const

export const ALIYUN_STEPS = [
  t('Add the identity provider'),
  t('Create the role'),
  t('Bind the role'),
] as const

export const TENCENT_STEPS = [
  t('Add the identity provider'),
  t('Create the role'),
  t('Authorize cluster access (optional)'),
  t('Bind the role'),
] as const

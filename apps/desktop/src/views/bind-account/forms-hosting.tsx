import { t } from '../../i18n'

import { Field } from './shared'

import type { BindState } from './use-bind-state'

export function LinodeForm({ st }: { st: BindState }) {
  const { linodeLabel, setLinodeLabel, linodeToken, setLinodeToken } = st

  return (
    <>
      <Field label={t('Label')} hint={t('A friendly name to identify this Linode account.')}>
        <input
          type="text"
          value={linodeLabel}
          onChange={(e) => setLinodeLabel(e.target.value)}
          placeholder={t('My Linode Account')}
          className="w-full h-9 px-2.5 rounded-md bg-surface border border-zGray-800 focus:border-zViolet-500 outline-none text-[12.5px] font-mono placeholder:text-tertiary text-main"
        />
      </Field>
      <Field
        label={t('Personal Access Token')}
        hint={t(
          'Create a token at Linode Cloud Manager → Profile → API Tokens with Read/Write access.',
        )}
      >
        <input
          type="password"
          value={linodeToken}
          onChange={(e) => setLinodeToken(e.target.value)}
          placeholder={t('Linode personal access token')}
          className="w-full h-9 px-2.5 rounded-md bg-surface border border-zGray-800 focus:border-zViolet-500 outline-none text-[12.5px] font-mono placeholder:text-tertiary text-main"
        />
      </Field>
    </>
  )
}

export function HetznerForm({ st }: { st: BindState }) {
  const { hetznerLabel, setHetznerLabel, hetznerToken, setHetznerToken } = st

  return (
    <>
      <Field label={t('Label')} hint={t('A friendly name to identify this Hetzner project.')}>
        <input
          type="text"
          value={hetznerLabel}
          onChange={(e) => setHetznerLabel(e.target.value)}
          placeholder={t('My Hetzner Project')}
          className="w-full h-9 px-2.5 rounded-md bg-surface border border-zGray-800 focus:border-zViolet-500 outline-none text-[12.5px] font-mono placeholder:text-tertiary text-main"
        />
      </Field>
      <Field
        label={t('API Token')}
        hint={t(
          'Create a token in Hetzner Cloud Console → your project → Security → API Tokens with Read & Write access.',
        )}
      >
        <input
          type="password"
          value={hetznerToken}
          onChange={(e) => setHetznerToken(e.target.value)}
          placeholder={t('Hetzner Cloud API token')}
          className="w-full h-9 px-2.5 rounded-md bg-surface border border-zGray-800 focus:border-zViolet-500 outline-none text-[12.5px] font-mono placeholder:text-tertiary text-main"
        />
      </Field>
    </>
  )
}

export function BetterStackForm({ st }: { st: BindState }) {
  const {
    betterStackLabel,
    setBetterStackLabel,
    betterStackUptimeApiToken,
    setBetterStackUptimeApiToken,
    betterStackTelemetryApiToken,
    setBetterStackTelemetryApiToken,
  } = st

  return (
    <>
      <Field label={t('Label')} hint={t('A friendly name for this Better Stack team or account.')}>
        <input
          type="text"
          value={betterStackLabel}
          onChange={(e) => setBetterStackLabel(e.target.value)}
          placeholder={t('Production Better Stack')}
          className="w-full h-9 px-2.5 rounded-md bg-surface border border-zGray-800 focus:border-zViolet-500 outline-none text-[12.5px] font-mono placeholder:text-tertiary text-main"
        />
      </Field>
      <Field
        label={t('Uptime API Token')}
        hint={t('Optional. Enables Uptime monitors and monitor configuration management.')}
      >
        <input
          type="password"
          value={betterStackUptimeApiToken}
          onChange={(e) => setBetterStackUptimeApiToken(e.target.value)}
          placeholder={t('Better Stack Uptime API token')}
          className="w-full h-9 px-2.5 rounded-md bg-surface border border-zGray-800 focus:border-zViolet-500 outline-none text-[12.5px] font-mono placeholder:text-tertiary text-main"
        />
      </Field>
      <Field
        label={t('Telemetry API Token')}
        hint={t('Optional. Enables Telemetry sources, collectors, and metrics.')}
      >
        <input
          type="password"
          value={betterStackTelemetryApiToken}
          onChange={(e) => setBetterStackTelemetryApiToken(e.target.value)}
          placeholder={t('Better Stack Telemetry API token')}
          className="w-full h-9 px-2.5 rounded-md bg-surface border border-zGray-800 focus:border-zViolet-500 outline-none text-[12.5px] font-mono placeholder:text-tertiary text-main"
        />
      </Field>
    </>
  )
}

export function UptimeKumaForm({ st }: { st: BindState }) {
  const {
    uptimeKumaLabel,
    setUptimeKumaLabel,
    uptimeKumaBaseUrl,
    setUptimeKumaBaseUrl,
    uptimeKumaAuthToken,
    setUptimeKumaAuthToken,
    uptimeKumaUsername,
    setUptimeKumaUsername,
    uptimeKumaPassword,
    setUptimeKumaPassword,
  } = st

  return (
    <>
      <Field label={t('Label')} hint={t('A friendly name for this Uptime Kuma instance.')}>
        <input
          type="text"
          value={uptimeKumaLabel}
          onChange={(e) => setUptimeKumaLabel(e.target.value)}
          placeholder={t('Production Uptime Kuma')}
          className="w-full h-9 px-2.5 rounded-md bg-surface border border-zGray-800 focus:border-zViolet-500 outline-none text-[12.5px] font-mono placeholder:text-tertiary text-main"
        />
      </Field>
      <Field label={t('Base URL')} hint={t('The public URL of your Uptime Kuma dashboard.')}>
        <input
          type="url"
          value={uptimeKumaBaseUrl}
          onChange={(e) => setUptimeKumaBaseUrl(e.target.value)}
          placeholder="https://status.example.com"
          className="w-full h-9 px-2.5 rounded-md bg-surface border border-zGray-800 focus:border-zViolet-500 outline-none text-[12.5px] font-mono placeholder:text-tertiary text-main"
        />
      </Field>
      <Field
        label={t('Auth Token')}
        hint={t(
          'Use this when the instance has 2FA enabled. Leave empty to use username/password.',
        )}
      >
        <input
          type="password"
          value={uptimeKumaAuthToken}
          onChange={(e) => setUptimeKumaAuthToken(e.target.value)}
          placeholder={t('Uptime Kuma auth token')}
          className="w-full h-9 px-2.5 rounded-md bg-surface border border-zGray-800 focus:border-zViolet-500 outline-none text-[12.5px] font-mono placeholder:text-tertiary text-main"
        />
      </Field>
      <Field label={t('Username')}>
        <input
          type="text"
          value={uptimeKumaUsername}
          onChange={(e) => setUptimeKumaUsername(e.target.value)}
          placeholder="admin"
          className="w-full h-9 px-2.5 rounded-md bg-surface border border-zGray-800 focus:border-zViolet-500 outline-none text-[12.5px] font-mono placeholder:text-tertiary text-main"
        />
      </Field>
      <Field label={t('Password')}>
        <input
          type="password"
          value={uptimeKumaPassword}
          onChange={(e) => setUptimeKumaPassword(e.target.value)}
          placeholder={t('Uptime Kuma password')}
          className="w-full h-9 px-2.5 rounded-md bg-surface border border-zGray-800 focus:border-zViolet-500 outline-none text-[12.5px] font-mono placeholder:text-tertiary text-main"
        />
      </Field>
    </>
  )
}

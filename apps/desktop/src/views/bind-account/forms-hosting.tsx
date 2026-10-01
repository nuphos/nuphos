import { Field } from './shared'

import type { BindState } from './use-bind-state'

export function LinodeForm({ st }: { st: BindState }) {
  const { linodeLabel, setLinodeLabel, linodeToken, setLinodeToken } = st

  return (
    <>
      <Field label="Label" hint="A friendly name to identify this Linode account.">
        <input
          type="text"
          value={linodeLabel}
          onChange={(e) => setLinodeLabel(e.target.value)}
          placeholder="My Linode Account"
          className="w-full h-9 px-2.5 rounded-md bg-field border border-zGray-800 focus:border-zViolet-500 outline-none text-[12.5px] font-mono placeholder:text-tertiary text-main"
        />
      </Field>
      <Field
        label="Personal Access Token"
        hint="Create a token at Linode Cloud Manager → Profile → API Tokens with Read/Write access."
      >
        <input
          type="password"
          value={linodeToken}
          onChange={(e) => setLinodeToken(e.target.value)}
          placeholder="Linode personal access token"
          className="w-full h-9 px-2.5 rounded-md bg-field border border-zGray-800 focus:border-zViolet-500 outline-none text-[12.5px] font-mono placeholder:text-tertiary text-main"
        />
      </Field>
    </>
  )
}

export function HetznerForm({ st }: { st: BindState }) {
  const { hetznerLabel, setHetznerLabel, hetznerToken, setHetznerToken } = st

  return (
    <>
      <Field label="Label" hint="A friendly name to identify this Hetzner project.">
        <input
          type="text"
          value={hetznerLabel}
          onChange={(e) => setHetznerLabel(e.target.value)}
          placeholder="My Hetzner Project"
          className="w-full h-9 px-2.5 rounded-md bg-field border border-zGray-800 focus:border-zViolet-500 outline-none text-[12.5px] font-mono placeholder:text-tertiary text-main"
        />
      </Field>
      <Field
        label="API Token"
        hint="Create a token in Hetzner Cloud Console → your project → Security → API Tokens with Read & Write access."
      >
        <input
          type="password"
          value={hetznerToken}
          onChange={(e) => setHetznerToken(e.target.value)}
          placeholder="Hetzner Cloud API token"
          className="w-full h-9 px-2.5 rounded-md bg-field border border-zGray-800 focus:border-zViolet-500 outline-none text-[12.5px] font-mono placeholder:text-tertiary text-main"
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
      <Field label="Label" hint="A friendly name for this Better Stack team or account.">
        <input
          type="text"
          value={betterStackLabel}
          onChange={(e) => setBetterStackLabel(e.target.value)}
          placeholder="Production Better Stack"
          className="w-full h-9 px-2.5 rounded-md bg-field border border-zGray-800 focus:border-zViolet-500 outline-none text-[12.5px] font-mono placeholder:text-tertiary text-main"
        />
      </Field>
      <Field
        label="Uptime API Token"
        hint="Optional. Enables Uptime monitors and monitor configuration management."
      >
        <input
          type="password"
          value={betterStackUptimeApiToken}
          onChange={(e) => setBetterStackUptimeApiToken(e.target.value)}
          placeholder="Better Stack Uptime API token"
          className="w-full h-9 px-2.5 rounded-md bg-field border border-zGray-800 focus:border-zViolet-500 outline-none text-[12.5px] font-mono placeholder:text-tertiary text-main"
        />
      </Field>
      <Field
        label="Telemetry API Token"
        hint="Optional. Enables Telemetry sources, collectors, and metrics."
      >
        <input
          type="password"
          value={betterStackTelemetryApiToken}
          onChange={(e) => setBetterStackTelemetryApiToken(e.target.value)}
          placeholder="Better Stack Telemetry API token"
          className="w-full h-9 px-2.5 rounded-md bg-field border border-zGray-800 focus:border-zViolet-500 outline-none text-[12.5px] font-mono placeholder:text-tertiary text-main"
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
      <Field label="Label" hint="A friendly name for this Uptime Kuma instance.">
        <input
          type="text"
          value={uptimeKumaLabel}
          onChange={(e) => setUptimeKumaLabel(e.target.value)}
          placeholder="Production Uptime Kuma"
          className="w-full h-9 px-2.5 rounded-md bg-field border border-zGray-800 focus:border-zViolet-500 outline-none text-[12.5px] font-mono placeholder:text-tertiary text-main"
        />
      </Field>
      <Field label="Base URL" hint="The public URL of your Uptime Kuma dashboard.">
        <input
          type="url"
          value={uptimeKumaBaseUrl}
          onChange={(e) => setUptimeKumaBaseUrl(e.target.value)}
          placeholder="https://status.example.com"
          className="w-full h-9 px-2.5 rounded-md bg-field border border-zGray-800 focus:border-zViolet-500 outline-none text-[12.5px] font-mono placeholder:text-tertiary text-main"
        />
      </Field>
      <Field
        label="Auth Token"
        hint="Use this when the instance has 2FA enabled. Leave empty to use username/password."
      >
        <input
          type="password"
          value={uptimeKumaAuthToken}
          onChange={(e) => setUptimeKumaAuthToken(e.target.value)}
          placeholder="Uptime Kuma auth token"
          className="w-full h-9 px-2.5 rounded-md bg-field border border-zGray-800 focus:border-zViolet-500 outline-none text-[12.5px] font-mono placeholder:text-tertiary text-main"
        />
      </Field>
      <Field label="Username">
        <input
          type="text"
          value={uptimeKumaUsername}
          onChange={(e) => setUptimeKumaUsername(e.target.value)}
          placeholder="admin"
          className="w-full h-9 px-2.5 rounded-md bg-field border border-zGray-800 focus:border-zViolet-500 outline-none text-[12.5px] font-mono placeholder:text-tertiary text-main"
        />
      </Field>
      <Field label="Password">
        <input
          type="password"
          value={uptimeKumaPassword}
          onChange={(e) => setUptimeKumaPassword(e.target.value)}
          placeholder="Uptime Kuma password"
          className="w-full h-9 px-2.5 rounded-md bg-field border border-zGray-800 focus:border-zViolet-500 outline-none text-[12.5px] font-mono placeholder:text-tertiary text-main"
        />
      </Field>
    </>
  )
}

import { useState } from 'react'

import { CLOUDFLARE_DEFAULT_SCOPE_ACCESS } from './constants'

export function useTokenProviderState() {
  const [cloudflareConnecting, setCloudflareConnecting] = useState(false)
  const [cfScopeAccess, setCfScopeAccess] = useState(CLOUDFLARE_DEFAULT_SCOPE_ACCESS)
  const [linodeLabel, setLinodeLabel] = useState('')
  const [linodeToken, setLinodeToken] = useState('')
  const [hetznerLabel, setHetznerLabel] = useState('')
  const [hetznerToken, setHetznerToken] = useState('')
  const [betterStackLabel, setBetterStackLabel] = useState('')
  const [betterStackUptimeApiToken, setBetterStackUptimeApiToken] = useState('')
  const [betterStackTelemetryApiToken, setBetterStackTelemetryApiToken] = useState('')
  const [uptimeKumaLabel, setUptimeKumaLabel] = useState('')
  const [uptimeKumaBaseUrl, setUptimeKumaBaseUrl] = useState('')
  const [uptimeKumaUsername, setUptimeKumaUsername] = useState('')
  const [uptimeKumaPassword, setUptimeKumaPassword] = useState('')
  const [uptimeKumaAuthToken, setUptimeKumaAuthToken] = useState('')
  const [tailscaleLabel, setTailscaleLabel] = useState('')
  const [tailscaleClientId, setTailscaleClientId] = useState('')
  const [tailscaleClientSecret, setTailscaleClientSecret] = useState('')
  const [tailscaleFederated, setTailscaleFederated] = useState(true)
  const [zeaburToken, setZeaburToken] = useState('')
  const [vantaLabel, setVantaLabel] = useState('')
  const [vantaClientId, setVantaClientId] = useState('')
  const [vantaClientSecret, setVantaClientSecret] = useState('')
  const [secureframeLabel, setSecureframeLabel] = useState('')
  const [secureframeRegion, setSecureframeRegion] = useState<'us' | 'uk'>('us')
  const [secureframeApiKey, setSecureframeApiKey] = useState('')
  const [secureframeApiSecret, setSecureframeApiSecret] = useState('')
  const [notionLabel, setNotionLabel] = useState('')
  const [notionToken, setNotionToken] = useState('')
  const [upstashLabel, setUpstashLabel] = useState('')
  const [upstashEmail, setUpstashEmail] = useState('')
  const [upstashApiKey, setUpstashApiKey] = useState('')
  const [resendLabel, setResendLabel] = useState('')
  const [resendApiKey, setResendApiKey] = useState('')

  function resetTokenState() {
    setCfScopeAccess(CLOUDFLARE_DEFAULT_SCOPE_ACCESS)
    setLinodeLabel('')
    setLinodeToken('')
    setHetznerLabel('')
    setHetznerToken('')
    setBetterStackLabel('')
    setBetterStackUptimeApiToken('')
    setBetterStackTelemetryApiToken('')
    setUptimeKumaLabel('')
    setUptimeKumaBaseUrl('')
    setUptimeKumaUsername('')
    setUptimeKumaPassword('')
    setUptimeKumaAuthToken('')
    setTailscaleLabel('')
    setTailscaleClientId('')
    setTailscaleClientSecret('')
    setTailscaleFederated(true)
    setZeaburToken('')
    setVantaLabel('')
    setVantaClientId('')
    setVantaClientSecret('')
    setSecureframeLabel('')
    setSecureframeRegion('us')
    setSecureframeApiKey('')
    setSecureframeApiSecret('')
    setNotionLabel('')
    setNotionToken('')
    setUpstashLabel('')
    setUpstashEmail('')
    setUpstashApiKey('')
    setResendLabel('')
    setResendApiKey('')
  }

  return {
    cloudflareConnecting,
    setCloudflareConnecting,
    cfScopeAccess,
    setCfScopeAccess,
    linodeLabel,
    setLinodeLabel,
    linodeToken,
    setLinodeToken,
    hetznerLabel,
    setHetznerLabel,
    hetznerToken,
    setHetznerToken,
    betterStackLabel,
    setBetterStackLabel,
    betterStackUptimeApiToken,
    setBetterStackUptimeApiToken,
    betterStackTelemetryApiToken,
    setBetterStackTelemetryApiToken,
    uptimeKumaLabel,
    setUptimeKumaLabel,
    uptimeKumaBaseUrl,
    setUptimeKumaBaseUrl,
    uptimeKumaUsername,
    setUptimeKumaUsername,
    uptimeKumaPassword,
    setUptimeKumaPassword,
    uptimeKumaAuthToken,
    setUptimeKumaAuthToken,
    tailscaleLabel,
    setTailscaleLabel,
    tailscaleClientId,
    setTailscaleClientId,
    tailscaleClientSecret,
    setTailscaleClientSecret,
    tailscaleFederated,
    setTailscaleFederated,
    zeaburToken,
    setZeaburToken,
    vantaLabel,
    setVantaLabel,
    vantaClientId,
    setVantaClientId,
    vantaClientSecret,
    setVantaClientSecret,
    secureframeLabel,
    setSecureframeLabel,
    secureframeRegion,
    setSecureframeRegion,
    secureframeApiKey,
    setSecureframeApiKey,
    secureframeApiSecret,
    setSecureframeApiSecret,
    notionLabel,
    setNotionLabel,
    notionToken,
    setNotionToken,
    upstashLabel,
    setUpstashLabel,
    upstashEmail,
    setUpstashEmail,
    upstashApiKey,
    setUpstashApiKey,
    resendLabel,
    setResendLabel,
    resendApiKey,
    setResendApiKey,
    resetTokenState,
  }
}

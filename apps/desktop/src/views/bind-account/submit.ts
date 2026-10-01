import {
  submitAliyun,
  submitAws,
  submitAzure,
  submitGcp,
  submitHuawei,
  submitTencent,
  submitVolcengine,
} from './submit-cloud'
import {
  submitBetterStack,
  submitHetzner,
  submitLinode,
  submitTailscale,
  submitUptimeKuma,
} from './submit-infra'
import {
  submitNotion,
  submitResend,
  submitSecureframe,
  submitUpstash,
  submitVanta,
  submitZeabur,
} from './submit-saas'

import type { SubmitEnv } from './submit-env'
import type { BindState } from './use-bind-state'

export type { SubmitEnv } from './submit-env'

export async function submitBind(st: BindState, env: SubmitEnv) {
  st.setError(null)
  if (st.provider === 'aws') {
    await submitAws(st, env)
  } else if (st.provider === 'gcp') {
    await submitGcp(st, env)
  } else if (st.provider === 'linode') {
    await submitLinode(st, env)
  } else if (st.provider === 'hetzner') {
    await submitHetzner(st, env)
  } else if (st.provider === 'betterstack') {
    await submitBetterStack(st, env)
  } else if (st.provider === 'uptime-kuma') {
    await submitUptimeKuma(st, env)
  } else if (st.provider === 'tailscale') {
    await submitTailscale(st, env)
  } else if (st.provider === 'vanta') {
    await submitVanta(st, env)
  } else if (st.provider === 'secureframe') {
    await submitSecureframe(st, env)
  } else if (st.provider === 'notion') {
    await submitNotion(st, env)
  } else if (st.provider === 'upstash') {
    await submitUpstash(st, env)
  } else if (st.provider === 'resend') {
    await submitResend(st, env)
  } else if (st.provider === 'tencent') {
    await submitTencent(st, env)
  } else if (st.provider === 'aliyun') {
    await submitAliyun(st, env)
  } else if (st.provider === 'volcengine') {
    await submitVolcengine(st, env)
  } else if (st.provider === 'huawei') {
    await submitHuawei(st, env)
  } else if (st.provider === 'azure') {
    await submitAzure(st, env)
  } else {
    await submitZeabur(st, env)
  }
}

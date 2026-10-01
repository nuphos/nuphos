import { callJson, teamQuery } from './http'

// ── Auto Mode standing-policy rules (user-scoped) ─────────────────────────
export type AutoModeRule = {
  id: string
  description: string
  status: 'proposed' | 'active'
  createdAt: string
  createdBy: string
  proposedFromConversationId?: string
}

export async function listAutoModeRules(): Promise<{ enabled: boolean; rules: AutoModeRule[] }> {
  return callJson<{ enabled: boolean; rules: AutoModeRule[] }>(
    'GET',
    `/agent/auto-mode/policy/rules`,
  )
}
export async function createAutoModeRule(description: string): Promise<{ rule: AutoModeRule }> {
  return callJson<{ rule: AutoModeRule }>('POST', `/agent/auto-mode/policy/rules`, { description })
}
export async function activateAutoModeRule(ruleId: string): Promise<{ ok: boolean }> {
  return callJson<{ ok: boolean }>(
    'POST',
    `/agent/auto-mode/policy/rules/${encodeURIComponent(ruleId)}/activate`,
    {},
  )
}
export async function deleteAutoModeRule(ruleId: string): Promise<void> {
  await callJson<{ ok: boolean }>(
    'DELETE',
    `/agent/auto-mode/policy/rules/${encodeURIComponent(ruleId)}`,
  )
}
export async function addAutoModeSessionApproval(
  sessionId: string,
  command: string,
): Promise<{ ok: boolean }> {
  return callJson<{ ok: boolean }>('POST', `/agent/auto-mode/session-approvals`, {
    sessionId,
    command,
  })
}
export async function getAutoModeBypass(
  sessionId: string,
): Promise<{ enabled: boolean; bypass: boolean }> {
  return callJson<{ enabled: boolean; bypass: boolean }>(
    'GET',
    `/agent/auto-mode/bypass?sessionId=${encodeURIComponent(sessionId)}`,
  )
}
export async function setAutoModeBypass(
  sessionId: string,
  bypass: boolean,
): Promise<{ ok: boolean; bypass: boolean }> {
  return callJson<{ ok: boolean; bypass: boolean }>('PUT', `/agent/auto-mode/bypass`, {
    sessionId,
    bypass,
  })
}

// Per-command authorization approve/deny (human-in-the-loop for bash).
export async function approveAutoModeCommand(
  sessionId: string,
  toolCallId: string,
  scope: 'once' | 'session' | 'always',
  teamId?: string,
  ruleDescription?: string,
): Promise<{ ok: boolean }> {
  return callJson<{ ok: boolean }>(
    'POST',
    `/agent/auto-mode/${encodeURIComponent(sessionId)}/approve${teamQuery(teamId)}`,
    { toolCallId, scope, ...(ruleDescription ? { ruleDescription } : {}) },
  )
}
export async function denyAutoModeCommand(
  sessionId: string,
  toolCallId: string,
  teamId?: string,
): Promise<void> {
  await callJson<{ ok: boolean }>(
    'POST',
    `/agent/auto-mode/${encodeURIComponent(sessionId)}/deny${teamQuery(teamId)}`,
    { toolCallId },
  )
}

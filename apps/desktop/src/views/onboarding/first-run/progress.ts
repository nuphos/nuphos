import { awsSteps, azureSteps, gcpSteps } from '../../../lib/cloudBindSteps'
import { isFirstRunPromptLang } from '../../../lib/firstRunConnect'

import type { FirstRunPromptLang, FirstRunProvider } from '../../../lib/firstRunConnect'

// Wide enough for the console instructions and their copy chips without the
// numbered rail crushing them. Not resizable: this is a task you finish, not a
// surface you live in.
export const PANEL_WIDTH = 400

// Same curve as the onboarding flow's reveals and this panel's width transition.
export const EASE_OUT = [0.22, 1, 0.36, 1] as const

export type Purpose = 'operational'

export type Stage =
  // One screen: the scenario and the cloud it applies to, together. The task
  // has to be the first thing on screen — a picker with nothing above it asks
  // for a decision before saying what it is for. But the three clouds' billing
  // grants do not answer the same questions, so the promise cannot be both
  // specific and made before the choice. It resolves in place instead: neutral
  // until a cloud is picked, that cloud's own scenario the moment one is.
  | { kind: 'pick'; provider: FirstRunProvider | null }
  | { kind: 'setup'; provider: FirstRunProvider; purpose: Purpose }
  | { kind: 'connected'; provider: FirstRunProvider }
  // One screen carries the whole conversation arc — ask, savings answer,
  // wall — as two flags that flip on the chat's breadcrumbs. The first three
  // steps are pre-written; the fourth arrives only once the answer lands.
  | {
      kind: 'first-question'
      provider: FirstRunProvider
      /** The question has been sent. */
      asked: boolean
      /** Its answer landed — the savings list AND the permission wall, since
       *  the one question asks for both. */
      answered: boolean
    }
  | { kind: 'finished'; provider: FirstRunProvider }

/** The chapter heading. Setup steps carry their own objective instead — see
 *  FirstRunPanel — so they never reach this. */
export function stageTitle(stage: Stage): string {
  if (stage.kind === 'first-question') return 'Your first answer'
  if (stage.kind === 'finished') return "You're fully set up"

  return "You're connected"
}

export const FRESH_FIRST_QUESTION = {
  asked: false,
  answered: false,
} as const

const PROGRESS_KEY_PREFIX = 'nuphos.firstRunConnect.progress'

export function setupTitles(provider: FirstRunProvider, purpose: Purpose): readonly string[] {
  return provider === 'aws'
    ? awsSteps(purpose)
    : provider === 'gcp'
      ? gcpSteps(purpose, true)
      : azureSteps(purpose)
}

function progressKey(teamId: string, provider: FirstRunProvider, purpose: Purpose): string {
  return `${PROGRESS_KEY_PREFIX}.${teamId}.${provider}.${purpose}`
}

export function readProgress(
  teamId: string,
  provider: FirstRunProvider,
  purpose: Purpose,
  total: number,
): number {
  if (typeof window === 'undefined') return 0
  try {
    const stored = Number(localStorage.getItem(progressKey(teamId, provider, purpose)) ?? 0)

    if (!Number.isFinite(stored)) return 0

    return Math.max(0, Math.min(Math.floor(stored), total - 1))
  } catch {
    return 0
  }
}

export function writeProgress(
  teamId: string,
  provider: FirstRunProvider,
  purpose: Purpose,
  step: number,
): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(progressKey(teamId, provider, purpose), String(step))
  } catch {
    // Storage unavailable — progress simply lasts for this mount.
  }
}

export function clearProgress(teamId: string, provider: FirstRunProvider, purpose: Purpose): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(progressKey(teamId, provider, purpose))
  } catch {
    // Storage unavailable — there is nothing durable to clear.
  }
}

// The language the user picked for the handed-out prompts. Not team-scoped:
// it's a property of the person reading the screen, not of the cloud account.
export const PROMPT_LANG_KEY = 'nuphos.firstRunConnect.promptLang'

export function readPromptLang(): FirstRunPromptLang {
  if (typeof window === 'undefined') return 'en'
  try {
    const stored = localStorage.getItem(PROMPT_LANG_KEY) ?? ''

    return isFirstRunPromptLang(stored) ? stored : 'en'
  } catch {
    return 'en'
  }
}

// How this cloud names each piece of the wiring. The diagram shows the user's
// real console objects, so the names must match what the setup just created.
export const WIRING: Record<FirstRunProvider, { home: string; identity: string; via: string }> = {
  aws: {
    home: 'Your AWS account',
    identity: 'NuphosRole',
    via: 'assumes the role via OIDC — no keys stored',
  },
  gcp: {
    home: 'Your Google Cloud project',
    identity: 'nuphos-connector',
    via: 'impersonates it — no keys stored',
  },
  azure: {
    home: 'Your Azure subscription',
    identity: 'Nuphos app',
    via: 'signs in via federated credential — no secrets stored',
  },
}

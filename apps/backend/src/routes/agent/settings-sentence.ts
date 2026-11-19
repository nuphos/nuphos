import type { OpenAbProvider } from '@/lib/claude-code-preview/runtime-provider'

// A settings line as one plain English sentence, which the phone apps show as it is.

export type Setting = 'model' | 'effort' | 'fast'

/** Who a line names first: a person, a Task acting for one, the agent itself, or Nuphos. */
export type LineActor =
  | { type: 'person'; id: string; name: string; avatarURL: string }
  | { type: 'task'; sessionId: string; title: string; provider?: OpenAbProvider }
  | { type: 'runtime'; label: string; provider?: OpenAbProvider }
  | { type: 'nuphos' }
/** A setting as the picker names it; an absent value is the agent's default. */
export type Shown = { setting: Setting; from?: string; to?: string }

const LABEL = { model: 'the model', effort: 'effort', fast: 'fast mode' }
const and = (parts: string[]) => new Intl.ListFormat('en', { type: 'conjunction' }).format(parts)
const short = (title: string) => (title.length > 40 ? `${title.slice(0, 39).trimEnd()}…` : title)

function actorName(actor: LineActor) {
  if (actor.type === 'person') return actor.name
  if (actor.type === 'task') return `${short(actor.title)} (a Task)`

  return actor.type === 'runtime' ? actor.label : 'Nuphos'
}

const fastTurned = (to?: string) => (to === 'on' || to === 'off' ? to : undefined)

function changed(settings: Shown[]) {
  if (settings.length === 1) {
    const [{ setting, from, to }] = settings as [Shown]

    if (setting === 'fast' && fastTurned(to)) return `turned fast mode ${to}`

    return ['changed', LABEL[setting], ...(from ? ['from', from] : []), 'to', to ?? 'Default'].join(
      ' ',
    )
  }

  return `changed ${and(
    settings.map(({ setting, to }) =>
      setting === 'fast' && fastTurned(to)
        ? `fast mode ${to}`
        : `${LABEL[setting]} to ${to ?? 'Default'}`,
    ),
  )}`
}

/** `values`: what an agent filled in, for a `set` line. */
export function sentenceOf(
  actor: LineActor,
  form: 'set' | 'changed',
  settings: Shown[],
  values: string[],
) {
  return form === 'set'
    ? `${actorName(actor)} set ${values.join(' · ')}`
    : `${actorName(actor)} ${changed(settings)}`
}

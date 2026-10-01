import yaml from 'js-yaml'
import { useEffect, useMemo, useState } from 'react'

import { api } from '../../api'
import { useRequiredKubeContext } from '../../hooks/useKubeContext'

import type { DetailTarget } from './target'

// Loads a resource's full object (via getResourceYaml) and parses it once.
// Shared by the PV/PVC overviews, which render structured fields off the parsed
// object rather than dumping raw YAML like GenericOverview does. Callers key the
// component on the target identity so it remounts on change — hence no in-effect
// state reset (keeps it clear of react-hooks/set-state-in-effect).
export function useResourceDoc(
  target: DetailTarget,
  refreshKey: number,
): {
  doc: unknown
  loading: boolean
  error: string | null
} {
  const context = useRequiredKubeContext()
  const [yamlText, setYamlText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    api
      .getResourceYaml(
        context,
        target.kind,
        target.namespace,
        target.name,
        target.apiVersion,
        target.plural,
      )
      .then((y) => {
        if (cancelled) return
        setError(null)
        setYamlText(y)
      })
      .catch((e: unknown) => !cancelled && setError(String(e instanceof Error ? e.message : e)))

    return () => {
      cancelled = true
    }
  }, [
    context,
    target.kind,
    target.namespace,
    target.name,
    target.apiVersion,
    target.plural,
    refreshKey,
  ])

  const parsed = useMemo(() => {
    if (yamlText == null) return null
    try {
      return { ok: true as const, doc: yaml.load(yamlText) }
    } catch (e) {
      return { ok: false as const, message: e instanceof Error ? e.message : String(e) }
    }
  }, [yamlText])

  // Surface a YAML parse failure rather than silently rendering an all-dash
  // summary. The text comes from our own getResourceYaml, so this is rare.
  const parseError =
    parsed && !parsed.ok ? `Failed to parse resource YAML: ${parsed.message}` : null

  return {
    doc: parsed && parsed.ok ? parsed.doc : null,
    loading: yamlText == null && error == null,
    error: error ?? parseError,
  }
}

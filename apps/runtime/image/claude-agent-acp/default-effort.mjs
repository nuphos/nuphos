/**
 * Claude ACP shows the effort a session runs with no pin as "Default". Name the
 * level Claude Code will actually send — get_settings' applied.effort — in that
 * choice's description, so a client can show "High" instead of "Default".
 */
export async function nuphosDescribeDefaultEffort(query, configOptions) {
  const effort = configOptions?.find((option) => option.category === 'thought_level')
  const inherited = effort?.options?.find((choice) => choice.value === 'default')

  if (!inherited || effort.currentValue !== 'default') return
  try {
    const applied = (await query.getSettings())?.applied?.effort

    if (typeof applied === 'string' && effort.options.some((choice) => choice.value === applied))
      inherited.description = applied
  } catch {
    // Older Claude Code has no get_settings; the choice keeps its plain name.
  }
}

function replaceOnce(source, anchor, replacement) {
  if (source.split(anchor).length !== 2)
    throw new Error(`Expected one Claude default-effort anchor: ${anchor.slice(0, 80)}`)

  return source.replace(anchor, () => replacement)
}

export function patchClaudeDefaultEffort(source) {
  const created =
    '            const configOptions = buildConfigOptions(modes, models, modelInfos, settingsEffortForModel(settingsManager.getSettings(), currentModelInfo), agents, currentAgent, fastMode);\n'
  const changed =
    '                session.effortPinnedByUser = value !== "default";\n            }\n        }\n    }\n'
  let patched = replaceOnce(
    source,
    created,
    `${created}            await nuphosDescribeDefaultEffort(q, configOptions);\n`,
  )

  patched = replaceOnce(
    patched,
    changed,
    `${changed.slice(0, -6)}        await nuphosDescribeDefaultEffort(session.query, session.configOptions);\n    }\n`,
  )

  return `${nuphosDescribeDefaultEffort.toString()}\n${patched}`
}

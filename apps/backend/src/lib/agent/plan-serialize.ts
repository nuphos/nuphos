import type { PlanDTO } from './plans'

// Collapse whitespace/newlines so user-controlled fields can't break the
// markdown list/heading structure.
function inline(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

// Render a plan as compact markdown for memory ingestion: title, status,
// overview, decisions, and step/job titles only — cost, risk, and command
// bodies are intentionally omitted.
export function serializePlanForMemory(plan: PlanDTO): string {
  const lines: string[] = [`# Plan #${plan.id}: ${inline(plan.title)} (${plan.status})`]
  const overview = plan.overview ? inline(plan.overview) : ''

  if (overview) lines.push('', overview)
  if (plan.decisions?.length) {
    lines.push('', '## Decisions')
    for (const d of plan.decisions) lines.push(`- ${inline(d.label)}: ${inline(d.value)}`)
  }
  if (plan.steps.length) {
    lines.push('', '## Steps')
    plan.steps.forEach((step, i) => {
      lines.push(`${String(i + 1)}. ${inline(step.title)}`)
      const desc = step.description ? inline(step.description) : ''

      if (desc) lines.push(`   ${desc}`)
      for (const job of step.jobs) {
        lines.push(`   - ${inline(job.title)}`)
        const jobDesc = job.description ? inline(job.description) : ''

        if (jobDesc) lines.push(`     ${jobDesc}`)
      }
    })
  }

  return lines.join('\n')
}

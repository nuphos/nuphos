---
name: soc2-incident-report
description: Generate an incident report that satisfies common SOC 2 Type II audit requirements (with optional ISO 22301 mapping). Trigger whenever the user asks to write, compile, or output an incident report — Incident Report, post-incident review, PIR, post-mortem, outage/failure report — in any language. Especially suited to service outages, security incidents, production failures, and customer-impacting events, and to the "Nuphos just finished investigating, now wrap it up into a report" flow. Output is Markdown (convertible to .docx or PDF) written in the user's preferred language.
---

# SOC 2 incident report

Use this skill to produce an incident report that satisfies common SOC 2 Type II
audit requirements, with optional mapping to ISO 22301:2019 BCMS clauses.

The most common trigger is **Nuphos has just finished investigating an
incident**: you already located the root cause through the monitoring / cloud /
database skills and applied a fix, and the user then says "write it up into an
incident report." In that case, collapse the whole investigation into the fixed
structure below.

## Output language

Write the report in the **user's preferred language** — infer it from the
language they are writing to you in, or honor an explicit request ("give me the
English version"). Translate the section headings accordingly; the section
*order and meaning* below are canonical, the wording is not. Keep widely-used
technical terms in their original English (memory leak, ingress controller,
on-call, connection pool) even in a non-English report. This skill file is in
English for maintainability — do not mirror that choice onto the output.

## Producing a report from a Nuphos investigation

When the report continues from Nuphos's own investigation, follow these three
rules:

1. **Fold the investigation path into the timeline (simplified).** Condense the
   key steps you actually took — which metrics you checked, which service you
   inspected, which directions you ruled out, how you finally pinned the root
   cause — into timeline entries. Do not paste raw command output; keep it to
   readable "at HH:mm, did X, concluded Y" lines. When you lack exact
   timestamps, use relative phrasing ("~20 min later") or mark "time TBD".
2. **Derive owners from context and memory — never invent names.** For fields
   like "primary responders" and the owner column of corrective/preventive
   actions, pull real names or roles from the conversation, on-call
   information, or existing memory. When genuinely unknown, use a role
   ("on-call engineer", "SRE lead") or `N/A` and remind the user to fill it in.
3. **The report is a selective, optional wrap-up.** Not every investigation
   needs one — produce it only when the user asks, or when the incident is
   severe enough to warrant retained audit evidence.

## Report structure

Produce the report in the following **fixed section order**. Notes per section:

### 1. Incident Summary
- 2–4 sentences: what happened, when, and how it was resolved.
- No detail — give the reader the whole picture fast.

### 2. Incident Metadata
Present the following fields as a table (use N/A when unknown):

| Field | Description |
|---|---|
| Incident name | Short identifying name |
| Severity | P1 / P2 / P3 (by impact scope, see below) |
| Status | In progress / Resolved |
| Affected customers | Customer name or "all users" |
| Affected services | Service name and environment (prod/staging) |
| Detected at | ISO 8601 or YYYY/MM/DD HH:mm TZ |
| Recovered at | Same format; "not yet recovered" if ongoing |
| Total downtime | Difference between detection and recovery |
| Primary responders | Names or roles |
| Preliminary technical root cause | One-line technical summary |
| Managerial root cause | Any process / people / access-control gap |

**Severity definitions (for classification):**
- **P1**: all users affected, or a core function completely unusable.
- **P2**: some users or some functionality affected.
- **P3**: minimal impact, a workaround exists, no customer complaints.

### 3. Timeline
- List key events in chronological order.
- Format: `YYYY/MM/DD HH:mm TZ: event description`
- Cover: detection, notification, engagement, investigation, recovery, follow-up confirmation.
- If this report continues a Nuphos investigation, include the simplified
  investigation path (metrics checked, directions ruled out, how the root cause
  was located).

### 4. Impact Assessment
Assess the five dimensions below in a table; mark each "Affected", "Not
affected", or "Under investigation" with a note:

| Dimension | Assessment | Notes |
|---|---|---|
| Service availability | | |
| User impact | | |
| Data integrity | | |
| Data confidentiality | | |
| Operational impact | | |

> SOC 2 auditors focus on **data integrity** and **data confidentiality** — even
> for a pure availability incident, address both dimensions explicitly rather
> than leaving them blank. **Scope the conclusion to the evidence you actually
> examined**: if you checked logs / audit trails / access records, write "No
> evidence of data exfiltration or unauthorized access was found based on
> \<the evidence checked\>"; if the investigation did not cover that evidence, mark
> it "Under investigation", "Not assessed", or "No evidence available in this
> investigation; requires security review" — never assert that nothing happened
> when you have not looked.

### 5. Immediate Response and Recovery
- Describe what each role did after the incident began.
- Narrate chronologically, emphasizing "who did what, and what result it achieved."
- Include both the workaround and the formal recovery actions.

### 6. Root Cause Analysis (RCA)
Three sub-sections:

#### 6.1 Technical root cause
- The direct technical cause of the incident.
- Attach supporting screenshots or data if available.

#### 6.2 Managerial root cause
- Any process gap, access-control issue, or communication problem.
- If none, state "no significant managerial root cause for this incident."

#### 6.3 Contributing factors
- Numbered list of everything that accelerated or amplified the impact.
- E.g. version issue, missing configuration, insufficient monitoring, concentrated access.

### 7. Corrective Actions
Present as a table:

| # | Action | Owner | Status | Link (optional) |
|---|---|---|---|---|

- Status: Done / In progress / To do.
- Corrective actions fix what already happened — restart a service, patch a
  version, revoke access.

### 8. Preventive Actions
Same table format.

- Preventive actions stop recurrence — add alerts, strengthen monitoring, write an SOP.

> **Key SOC 2 requirement**: corrective and preventive actions must be listed
> separately, and each must have a clear owner and tracked status. This is an
> audit focus of CC7.4 (Incident Response Procedures) and CC9.1 (Risk
> Mitigation).

### 9. Verification
- How to confirm each action took effect (measurable, verifiable).
- E.g. monitoring dashboard screenshot, load-test results, a second engineer confirming access.

### 10. Lessons Learned
- 2–4 paragraphs on the systemic issues this incident exposed.
- Cover not just the technical problem but the process and organizational learning.

### 11. SOC 2 / Compliance Mapping
Table mapping this report to the relevant SOC 2 Trust Services Criteria (TSC)
and/or ISO 22301 clauses:

| Clause | Corresponding content |
|---|---|
| CC7.3 (Evaluate Security Events) | ... |
| CC7.4 (Incident Response) | ... |
| CC7.5 (Incident Recovery) | ... |
| A1.2 (Availability / Environmental Threats) | ... |

> If the customer specifically requires ISO 22301 mapping, add a second ISO
> table (clauses 10.1.1–10.1.3).

### 12. Closure Criteria
List, as a checkbox list, the items that must be complete before closing:

```
- [x] Affected service recovered and confirmed stable
- [ ] Root cause fully documented
- [ ] All corrective actions completed or under a tracking plan
- [ ] Affected customers notified (if applicable)
- [ ] Report reviewed by a manager or the security owner
```

### 13. Conclusion
- 2–3 sentences: what happened, how it recovered, and the long-term prevention.

---

## How to use

### Mode A: build the report from raw information
The user provides incident information (times, symptoms, handling, root cause);
organize it into the structure above and output the full report. Ask for the
following required information if not yet provided:

1. Detection time and recovery time
2. Affected services / customers
3. Known technical root cause
4. Actions already taken
5. Any tracking tickets (e.g. Linear / Jira issue links)

### Mode B: convert an existing document
If the user provides an existing incident record (Slack thread, meeting notes,
an engineer's memo), reorganize it into the section structure and fill missing
fields (use N/A or mark "to be completed").

### Mode C: continue a Nuphos investigation (most common)
Nuphos has just investigated an incident with the other skills and the user asks
to wrap it up. You already hold most of the material — timings, symptoms,
investigation path, root cause, and actions are in the conversation. Map them to
the sections above, fold the simplified investigation path into the timeline,
and set owners from context and memory. Only ask the user for the fields you are
still missing.

---

## Language and formatting notes

- Write the report in the user's preferred language (see "Output language"); keep
  common technical terms in English (memory leak, ingress controller, on-call).
- If the user asks for a different language, re-render the whole report in it —
  the structure stays identical.
- Use `YYYY/MM/DD HH:mm TZ` for all times in tables.
- For corrective/preventive actions with a Linear or Jira link, put it in the
  link column. If the team has bound Linear, you can use the `linear` skill to
  open tracking issues and paste the links back into the tables.

---

## SOC 2 auditor focus points (self-check before generating)

Before emitting the report, confirm all of the following are covered:

- [ ] Severity classified (P1/P2/P3)
- [ ] Data confidentiality and integrity explicitly assessed (scope the conclusion to the evidence checked; mark "Under investigation" / "Not assessed" when it was not examined)
- [ ] RCA has both a technical and a managerial dimension
- [ ] Corrective and preventive actions each have a **clear owner** and **status**
- [ ] Each action is trackable (a ticket link or a verifiable result)
- [ ] The report has explicit closure criteria
- [ ] The timeline is complete enough to reconstruct the incident

---

## Reference

For detailed SOC 2 TSC clause mapping when filling in the "Compliance Mapping"
section, see `skills/soc2-incident-report/references/soc2-tsc-mapping.md`.

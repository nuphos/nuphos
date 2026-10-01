# SOC 2 Trust Services Criteria — incident report mapping

This file lists the SOC 2 TSC clauses most relevant to an incident report, as a
reference for filling in the "Compliance Mapping" section. It is guidance for
you; the report itself is written in the user's preferred language.

---

## Quick reference table

| TSC clause | Name | What it maps to in the incident report |
|---|---|---|
| **CC7.2** | Monitor System Components | Whether monitoring detected the incident, or why it didn't detect it earlier |
| **CC7.3** | Evaluate Security Events | How the incident type and severity were judged, and the initial assessment |
| **CC7.4** | Respond to Security Incidents | The response actions, notification flow, and handling steps after the incident |
| **CC7.5** | Identify and Recover from Incidents | How the service recovered, and how recovery was verified |
| **CC9.1** | Risk Mitigation Activities | Corrective and preventive actions that reduce future risk |
| **A1.1** | Availability / Capacity Management | Whether capacity planning or resource limits contributed |
| **A1.2** | Availability / Environmental Threats | The link between an environment change (version upgrade, config change) and the incident |
| **A1.3** | Availability / Recovery | RTO/RPO targets and whether actual recovery time met them |

---

## Clause detail

### CC7.2 — Monitor System Components
**Audit focus**: does the organization have monitoring that can detect anomalies?

In the report:
- State whether the incident was reported by a customer or detected by internal monitoring.
- If the customer reported it first, explain why internal monitoring did not alert earlier.
- Corrective/preventive actions should include a "strengthen monitoring/alerting" item.

---

### CC7.3 — Evaluate Security Events
**Audit focus**: can the organization correctly assess an incident's nature and scope?

In the report:
- The impact-assessment table (availability, data confidentiality, data integrity) maps to this clause.
- Explicitly state whether the incident involved any security impact (data exfiltration, unauthorized access).
- Even for a pure availability incident, address the confidentiality/integrity
  dimensions rather than leaving them blank — but scope the conclusion to the
  evidence actually reviewed. If logs / audit trails / access records were
  checked, say so ("no evidence of exfiltration or unauthorized access based on
  \<evidence\>"). If they were not, mark it "Under investigation", "Not assessed",
  or "requires security review" instead of asserting nothing happened.

---

### CC7.4 — Respond to Security Incidents
**Audit focus**: does the organization have a defined incident-response procedure, and did it follow it?

In the report:
- The "Immediate Response and Recovery" section maps directly to this clause.
- State whether the on-call flow was triggered and whether the notification chain was clear.
- If there was a delay (e.g. an access-control problem), explain why and record it in corrective actions.

---

### CC7.5 — Identify and Recover from Incidents
**Audit focus**: can the organization recover effectively and document the recovery?

In the report:
- Describe the concrete actions taken to recover (restart, rollback, patch).
- The Verification section states how recovery was confirmed.
- Downtime (MTTR) is a quantitative metric — record it in the metadata.

---

### CC9.1 — Risk Mitigation Activities
**Audit focus**: does the organization identify risk and act to reduce it?

In the report:
- Corrective actions = response to a realized risk (patching a known defect).
- Preventive actions = reduction of a potential risk (writing an SOP, strengthening monitoring).
- Each action needs an owner and a status — auditors will track whether it was actually done.

---

### A1.1 / A1.2 / A1.3 — Availability Criteria
**Audit focus**: does the organization manage system availability and recover after an interruption?

In the report:
- A1.1: insufficient memory/CPU capacity planning is a capacity-management issue.
- A1.2: an ingress controller upgrade causing a memory leak is an environment-change risk.
- A1.3: the RTO target, and whether this incident's actual MTTR met the SLA.

---

## ISO 22301:2019 mapping (if applicable)

| ISO 22301 clause | Corresponding content |
|---|---|
| **10.1.1** Determine opportunities for improvement | Lessons learned and preventive actions that improve the BCMS beyond fixing this specific incident |
| **10.1.2** React to the nonconformity and take corrective action | The support engagement, access acquisition, investigation, and forced restart taken after the incident, plus the analysis of technical and managerial root causes, the corrective actions that prevent recurrence, and the review of whether those corrective actions were effective |
| **10.1.3** Retain documented information as evidence | Retain the timeline, RCA, handling actions, improvement items, and verification |

---

## Frequently audited failure points

1. **Unclear ownership**: every corrective/preventive action needs a real name or a clear role.
2. **Actions without verification**: a completed action needs a verifiable result.
3. **Security impact not addressed**: even an availability incident must assess confidentiality/integrity — stating "no evidence of exfiltration found based on \<the evidence checked\>" when logs were reviewed, or "Under investigation / requires security review" when they were not. Do not claim nothing happened without evidence.
4. **Gaps in the timeline**: no unexplained time gap between notification and recovery.
5. **Not tracked to closure**: the report needs closure criteria, and is only marked Done once all are met.

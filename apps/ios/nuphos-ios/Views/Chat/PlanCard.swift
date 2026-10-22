import SwiftUI

/// A plan the agent proposed: title, status, overview, steps, cost/risk,
/// and approve / reject / request-changes while it is still `proposed`.
/// Polls while the plan is active, like the desktop.
struct PlanCard: View {
    let planId: String
    let session: ChatSession

    @State private var plan: Plan?
    @State private var error: String?
    @State private var busy = false
    @State private var showRevise = false
    @State private var reviseReason = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let plan {
                header(plan)
                if !plan.overview.isEmpty {
                    Text(plan.overview).font(Theme.Text.secondary).lineSpacing(Theme.Text.leading).foregroundStyle(Theme.body).textSelection(.enabled)
                }
                if !plan.steps.isEmpty { steps(plan) }
                facts(plan)
                if let e = plan.executionError { HintRow(text: e, isError: true) }
                actions(plan)
            } else if let error {
                HintRow(text: error, isError: true)
            } else {
                HStack(spacing: 8) { ProgressView().controlSize(.small); Text("Loading plan…").font(Theme.Text.label).foregroundStyle(Theme.muted) }
            }
        }
        .padding(14)
        .background(Theme.chatSurface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 1))
        .task(id: planId) { await poll() }
        .alert("Request changes", isPresented: $showRevise) {
            TextField("What should change?", text: $reviseReason)
            Button("Send") { session.requestPlanChanges(reviseReason); reviseReason = "" }
                .disabled(reviseReason.trimmingCharacters(in: .whitespaces).isEmpty)
            Button("Cancel", role: .cancel) {}
        }
    }

    private func header(_ plan: Plan) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "list.clipboard").font(Theme.Text.secondary.weight(.semibold)).foregroundStyle(Theme.body)
            VStack(alignment: .leading, spacing: 2) {
                Text(plan.number.map { "Plan #\($0)" } ?? "Plan #\(plan.id)").font(Theme.Text.micro.weight(.semibold)).foregroundStyle(Theme.muted)
                Text(plan.title).font(Theme.Text.body.weight(.semibold)).foregroundStyle(Theme.heading)
            }
            Spacer(minLength: 8)
            StatusBadge(status: plan.status)
        }
    }

    private func steps(_ plan: Plan) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(Array(plan.steps.enumerated()), id: \.offset) { index, step in
                DisclosureGroup {
                    VStack(alignment: .leading, spacing: 8) {
                        if let d = step.description, !d.isEmpty {
                            Text(d).font(Theme.Text.label).foregroundStyle(Theme.body)
                        }
                        ForEach(Array(step.jobs.enumerated()), id: \.offset) { _, job in
                            VStack(alignment: .leading, spacing: 4) {
                                Text(job.title).font(Theme.Text.label.weight(.medium)).foregroundStyle(Theme.heading)
                                ForEach(Array(job.commands.enumerated()), id: \.offset) { _, cmd in
                                    HStack(alignment: .top, spacing: 6) {
                                        commandStatus(cmd.status)
                                        Text(cmd.command).font(Theme.Text.mono(.caption)).foregroundStyle(Theme.body).textSelection(.enabled)
                                    }
                                }
                            }
                        }
                    }
                    .padding(.top, 4)
                } label: {
                    HStack(spacing: 8) {
                        Text("\(index + 1)").font(.system(.caption2, design: .rounded).weight(.bold))
                            .padding(4).frame(minWidth: 20, minHeight: 20).background(Theme.bubble, in: Circle()).foregroundStyle(Theme.heading)
                        Text(step.title).font(Theme.Text.secondary.weight(.medium)).foregroundStyle(Theme.heading)
                    }
                }
                .disclosureGroupStyle(PlanStepDisclosureStyle())
            }
        }
    }

    @ViewBuilder
    private func commandStatus(_ status: String?) -> some View {
        switch status {
        case "running": ProgressView().controlSize(.mini)
        case "done": Image(systemName: "checkmark.circle.fill").font(Theme.Text.caption).foregroundStyle(.green)
        case "failed": Image(systemName: "xmark.circle.fill").font(Theme.Text.caption).foregroundStyle(.red)
        default: Image(systemName: "circle").font(Theme.Text.caption).foregroundStyle(Theme.muted)
        }
    }

    private func facts(_ plan: Plan) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            if let c = plan.costSummary, !c.isEmpty { fact("Cost", c) }
            if let r = plan.riskWorstCase, !r.isEmpty { fact("Worst case", r) }
            if !plan.riskMitigations.isEmpty { fact("Mitigations", plan.riskMitigations.joined(separator: " · ")) }
            if let p = plan.approvalProgress, !p.satisfied, plan.status == "proposed" {
                let remaining = max(0, p.minimumOtherApprovals - p.otherApprovals)
                if remaining > 0 { fact("Approvals", "waiting for \(remaining) more") }
            }
        }
    }

    private func fact(_ label: String, _ value: String) -> some View {
        HStack(alignment: .top, spacing: 6) {
            Text(label + ":").font(Theme.Text.caption.weight(.semibold)).foregroundStyle(Theme.muted)
            Text(value).font(Theme.Text.caption).foregroundStyle(Theme.body)
        }
    }

    @ViewBuilder
    private func actions(_ plan: Plan) -> some View {
        if plan.status == "proposed", !session.readOnly {
            HStack(spacing: 8) {
                Button { Task { await run { try await session.approvePlan(plan.id) } } } label: {
                    Text("Approve")
                }
                .prominentButton()
                Button("Request changes") { showRevise = true }
                    .buttonStyle(.bordered)
                Button("Reject", role: .destructive) { Task { await run { try await session.rejectPlan(plan.id) } } }
                    .buttonStyle(.bordered)
            }
            .controlSize(.small)
            .font(Theme.Text.label.weight(.medium))
            .disabled(busy || session.isStreaming)
        }
    }

    private func run(_ op: () async throws -> Plan) async {
        busy = true
        defer { busy = false }
        do { plan = try await op() } catch { self.error = error.localizedDescription }
    }

    private func poll() async {
        while !Task.isCancelled {
            do {
                let p = try await session.plan(planId)
                plan = p
                error = nil
                guard p.isActive else { return }
            } catch {
                if plan == nil { self.error = error.localizedDescription }
            }
            try? await Task.sleep(for: .milliseconds(1500))
        }
    }
}

struct PlanStepDisclosureStyle: DisclosureGroupStyle {
    @Environment(\.transcriptReadingInteraction) private var readingInteraction

    func makeBody(configuration: Configuration) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                disclose(readingInteraction) { configuration.isExpanded.toggle() }
            } label: {
                HStack {
                    configuration.label
                    Spacer(minLength: 8)
                    Image(systemName: configuration.isExpanded ? "chevron.down" : "chevron.right")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Theme.muted)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityValue(configuration.isExpanded ? "Expanded" : "Collapsed")
            if configuration.isExpanded {
                configuration.content
            }
        }
    }
}

private struct TranscriptReadingInteractionKey: EnvironmentKey {
    static let defaultValue: () -> Void = {}
}

extension EnvironmentValues {
    var transcriptReadingInteraction: () -> Void {
        get { self[TranscriptReadingInteractionKey.self] }
        set { self[TranscriptReadingInteractionKey.self] = newValue }
    }
}

/// A disclosure in the transcript is a reading interaction, not a request to
/// follow the bottom. Apply its new size atomically: SwiftUI's height
/// animation and a self-sizing collection cell otherwise animate the same
/// geometry twice, and the row's title jumps away and slides back.
@MainActor
func disclose(_ readingInteraction: () -> Void, _ change: () -> Void) {
    readingInteraction()
    var transaction = Transaction(animation: nil)
    transaction.disablesAnimations = true
    withTransaction(transaction, change)
}

/// The desktop `PlanStatusBadge`: one label + tone per lifecycle status,
/// shared by the chat card, the library row and the detail page.
struct StatusBadge: View {
    let status: String

    private var label: String {
        switch status {
        case "cancelled": "Unplanned"
        default: status.capitalized
        }
    }

    private var tint: Color {
        switch status {
        case "proposed", "approved", "executing": Theme.brandText
        case "completed": .green
        case "failed": .red
        case "rejected", "cancelled": Theme.muted
        default: .orange
        }
    }

    var body: some View {
        Text(label)
            .font(Theme.Text.micro.weight(.semibold))
            .foregroundStyle(tint)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(tint.opacity(0.12), in: Capsule())
    }
}

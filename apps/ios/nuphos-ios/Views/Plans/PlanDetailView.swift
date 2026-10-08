import SwiftUI

/// A plan on its own page — the desktop `PlanSidePanel`: header, decisions,
/// steps with live command status, cost, risk, approvals, and the actions
/// the library offers (approve, continue in chat, mark as unplanned).
/// Polls while the plan is active.
struct PlanDetailView: View {
    @Environment(PlansStore.self) private var plans
    let planId: String
    /// The plan's team when it is not the library's (a link in a chat).
    var teamId: String?
    /// Replaces the library's plain PATCH — in a chat, approving also tells
    /// the agent to proceed, so the session's approve is used instead.
    var approve: ((Plan) async throws -> Plan)?
    /// Off when the page is shown inside the conversation it points at.
    var showsChatActions = true

    @State private var fetched: Plan?
    @State private var loadError: String?
    @State private var busy = false
    @State private var notice: String?
    @State private var chatTarget: PlanChatTarget?
    @State private var confirmUnplan = false

    private var plan: Plan? { plans.plan(planId) ?? fetched }

    var body: some View {
        Group {
            if let plan {
                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        header(plan)
                        if !plan.decisions.isEmpty { decisions(plan) }
                        if plan.status == "failed", let e = plan.executionError, !e.isEmpty {
                            card { HintRow(text: e, isError: true) }
                        }
                        if plan.status == "proposed", !plan.isReadyForApproval { building(plan) }
                        if !plan.steps.isEmpty { steps(plan) }
                        if plan.costSummary != nil || plan.costOneTime != nil || plan.costMonthly != nil || plan.costSavings != nil { cost(plan) }
                        if plan.riskWorstCase != nil || !plan.riskMitigations.isEmpty { risk(plan) }
                        approvals(plan)
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                }
                .safeAreaInset(edge: .bottom, spacing: 0) { actionBar(plan) }
            } else if let loadError {
                ContentUnavailableView {
                    Label("Couldn't load plan", systemImage: "wifi.exclamationmark")
                } description: {
                    Text(loadError)
                } actions: {
                    Button("Try again") { Task { await refresh() } }.buttonStyle(.borderedProminent)
                }
            } else {
                ProgressView("Loading plan…").tint(Theme.muted)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.canvas)
        .navigationTitle(plan?.displayNumber ?? "Plan")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar {
            if let plan {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        if showsChatActions, let target = PlanChatTarget(plan: plan) {
                            Button { chatTarget = target } label: { Label(target.buttonTitle, systemImage: "bubble.left") }
                        }
                        if plan.isCancellable {
                            Divider()
                            Button(role: .destructive) { confirmUnplan = true } label: {
                                Label("Mark as unplanned", systemImage: "nosign")
                            }
                        }
                    } label: {
                        Label("Plan actions", systemImage: "ellipsis")
                    }
                }
            }
        }
        .navigationDestination(item: $chatTarget) { target in
            PlanConversationView(target: target)
        }
        .confirmationDialog("Mark plan \(plan?.displayNumber ?? "") as unplanned?", isPresented: $confirmUnplan, titleVisibility: .visible) {
            Button("Mark as unplanned", role: .destructive) {
                if let plan { Task { await plans.markUnplanned(plan) } }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("The plan is kept for reference but will no longer be run.")
        }
        .alert("Couldn't approve plan", isPresented: Binding(get: { notice != nil }, set: { if !$0 { notice = nil } })) {
            Button("OK") { notice = nil }
        } message: {
            Text(notice ?? "")
        }
        .task(id: planId) { await poll() }
    }

    // MARK: - Sections

    private func card<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 10, content: content)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(14)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 1))
    }

    private func sectionTitle(_ title: LocalizedStringKey, systemImage: String, tint: Color = Theme.brandText) -> some View {
        Label(title, systemImage: systemImage)
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(tint)
    }

    private func header(_ plan: Plan) -> some View {
        card {
            HStack(spacing: 8) {
                Text("Plan \(plan.displayNumber)")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Theme.brandText)
                StatusBadge(status: plan.status)
                Text("·").foregroundStyle(Theme.muted)
                Text(counts(plan))
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.muted)
                    .lineLimit(1)
            }
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: "list.clipboard")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Theme.body)
                    .padding(.top, 2)
                Text(plan.title.isEmpty ? "Untitled plan" : plan.title)
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(Theme.heading)
                    .textSelection(.enabled)
            }
            if !plan.overview.isEmpty {
                Text(plan.overview)
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.body)
                    .textSelection(.enabled)
            }
            HStack(spacing: 6) {
                if let creator = plans.member(plan.createdBy) {
                    AvatarView(user: creator.asUser, size: 18)
                    Text(creator.isRemoved ? "\(creator.displayName) (former member)" : creator.displayName)
                }
                if let createdAt = plan.createdAt {
                    if plans.member(plan.createdBy) != nil { Text("·") }
                    Text(HistoryTime.format(createdAt) == "now" ? "just now" : "\(HistoryTime.format(createdAt)) ago")
                }
            }
            .font(.system(size: 12))
            .foregroundStyle(Theme.muted)
        }
    }

    private func counts(_ plan: Plan) -> String {
        var parts = ["\(plan.steps.count) step\(plan.steps.count == 1 ? "" : "s")", "\(plan.totalJobs) job\(plan.totalJobs == 1 ? "" : "s")"]
        if plan.totalCommands > 0 { parts.append("\(plan.totalCommands) command\(plan.totalCommands == 1 ? "" : "s")") }
        return parts.joined(separator: " · ")
    }

    private func building(_ plan: Plan) -> some View {
        card {
            HStack(spacing: 8) {
                ProgressView().controlSize(.small)
                Text("The agent is still building this plan — steps, cost and risk arrive before it can be approved.")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.muted)
            }
        }
    }

    private func decisions(_ plan: Plan) -> some View {
        card {
            sectionTitle("Decisions", systemImage: "slider.horizontal.3")
            ForEach(Array(plan.decisions.enumerated()), id: \.offset) { _, d in
                VStack(alignment: .leading, spacing: 2) {
                    if !d.label.isEmpty {
                        Text(d.label).font(.system(size: 12)).foregroundStyle(Theme.muted)
                    }
                    Text(d.value).font(.system(size: 13, weight: .medium)).foregroundStyle(Theme.heading).textSelection(.enabled)
                }
            }
        }
    }

    private func steps(_ plan: Plan) -> some View {
        card {
            sectionTitle("Steps", systemImage: "list.number")
            PlanStepsView(steps: plan.steps)
        }
    }

    private func cost(_ plan: Plan) -> some View {
        card {
            sectionTitle("Cost", systemImage: "dollarsign.circle", tint: .green)
            if let s = plan.costSummary, !s.isEmpty {
                Text(s).font(.system(size: 13)).foregroundStyle(Theme.body).textSelection(.enabled)
            }
            VStack(alignment: .leading, spacing: 4) {
                if let v = plan.costOneTime, !v.isEmpty { fact("One-time", v) }
                if let v = plan.costMonthly, !v.isEmpty { fact("Monthly", v) }
                if let v = plan.costSavings, !v.isEmpty { fact("Savings", v) }
            }
        }
    }

    private func risk(_ plan: Plan) -> some View {
        card {
            sectionTitle("Risk", systemImage: "exclamationmark.triangle", tint: .red)
            if let w = plan.riskWorstCase, !w.isEmpty { fact("Worst case", w) }
            if !plan.riskMitigations.isEmpty {
                Text("Mitigations").font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.muted)
                ForEach(Array(plan.riskMitigations.enumerated()), id: \.offset) { _, m in
                    HStack(alignment: .top, spacing: 6) {
                        Image(systemName: "shield").font(.system(size: 11)).foregroundStyle(Theme.muted).padding(.top, 2)
                        Text(m).font(.system(size: 13)).foregroundStyle(Theme.body).textSelection(.enabled)
                    }
                }
            }
        }
    }

    private func approvals(_ plan: Plan) -> some View {
        card {
            sectionTitle("Approval", systemImage: "checkmark.shield")
            if let p = plan.approvalProgress {
                HStack(spacing: 10) {
                    approvalChip("Requester", done: p.requesterApproved, required: p.requesterApprovalRequired)
                    approvalChip("Team \(p.otherApprovals)/\(p.minimumOtherApprovals)", done: p.otherApprovals >= p.minimumOtherApprovals, required: p.minimumOtherApprovals > 0)
                }
                if plan.status == "proposed" {
                    Text(p.remaining == 0
                         ? "Approval gate met."
                         : "Waiting for \(p.remaining) more required approval\(p.remaining == 1 ? "" : "s").")
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.muted)
                }
            } else {
                Text("\(plan.approvalCount) approval\(plan.approvalCount == 1 ? "" : "s") recorded.")
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.muted)
            }
        }
    }

    private func approvalChip(_ title: String, done: Bool, required: Bool) -> some View {
        Label(title, systemImage: done ? "checkmark.circle.fill" : "circle")
            .font(.system(size: 12, weight: .medium))
            .foregroundStyle(done ? Color.green : (required ? Theme.body : Theme.muted))
    }

    private func fact(_ label: LocalizedStringKey, _ value: String) -> some View {
        HStack(alignment: .top, spacing: 6) {
            Text(label).font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.muted)
            Text(value).font(.system(size: 13)).foregroundStyle(Theme.body).textSelection(.enabled)
        }
    }

    // MARK: - Actions

    @ViewBuilder
    private func actionBar(_ plan: Plan) -> some View {
        let chat = showsChatActions ? PlanChatTarget(plan: plan) : nil
        let canApprove = plan.status == "proposed" && plan.isReadyForApproval
        if canApprove || (chat != nil && ["proposed", "approved"].contains(plan.status)) {
            HStack(spacing: 10) {
                if canApprove {
                    Button {
                        Task { await approve(plan) }
                    } label: {
                        Label("Approve", systemImage: "checkmark")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(Theme.brand)
                    .disabled(busy)
                }
                if let chat {
                    Button {
                        chatTarget = chat
                    } label: {
                        Label(chat.buttonTitle, systemImage: "bubble.left")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                    .disabled(busy)
                }
            }
            .controlSize(.large)
            .font(.system(size: 15, weight: .medium))
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(.bar)
        }
    }

    private func approve(_ plan: Plan) async {
        busy = true
        defer { busy = false }
        do {
            let updated: Plan
            if let approve {
                updated = try await approve(plan)
                plans.apply(updated)
            } else {
                updated = try await plans.approve(plan)
            }
            if updated.status != "approved", updated.approvalCount == plan.approvalCount {
                notice = "Your approval is already recorded on this plan."
            }
        } catch {
            notice = error.localizedDescription
        }
    }

    private func refresh() async {
        do {
            fetched = try await plans.fetch(planId, teamId: teamId)
            loadError = nil
        } catch {
            if plan == nil { loadError = error.localizedDescription }
        }
    }

    private func poll() async {
        while !Task.isCancelled {
            await refresh()
            guard plan?.isActive ?? true else { return }
            try? await Task.sleep(for: .seconds(3))
        }
    }
}

/// The steps list shared by the detail page: one disclosure per step with
/// the desktop's rolled-up status; running and failed steps start open.
struct PlanStepsView: View {
    let steps: [Plan.Step]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(Array(steps.enumerated()), id: \.offset) { index, step in
                PlanStepDisclosure(index: index + 1, step: step, status: resolved[index])
            }
        }
    }

    /// `resolveStepStatuses`: only the last `running` step is really
    /// running; earlier ones the agent forgot to close read as `partial`.
    private var resolved: [String?] {
        let rolled = steps.map(\.rollupStatus)
        let active = rolled.lastIndex(of: "running")
        return rolled.enumerated().map { i, s in s == "running" && i != active ? "partial" : s }
    }
}

private struct PlanStepDisclosure: View {
    let index: Int
    let step: Plan.Step
    let status: String?

    @State private var override: Bool?

    private var open: Bool {
        guard !step.jobs.isEmpty else { return true }
        return override ?? (status == "running" || status == "failed")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button {
                withAnimation(.snappy(duration: 0.25)) { override = !open }
            } label: {
                HStack(spacing: 8) {
                    stepIcon
                    Text(step.title)
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(Theme.heading)
                        .multilineTextAlignment(.leading)
                    Spacer(minLength: 4)
                    if !step.jobs.isEmpty {
                        Image(systemName: "chevron.right")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(Theme.muted)
                            .rotationEffect(.degrees(open ? 90 : 0))
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            Collapsible(expanded: open) {
                VStack(alignment: .leading, spacing: 8) {
                    if let d = step.description, !d.isEmpty {
                        Text(d).font(.system(size: 13)).foregroundStyle(Theme.body).textSelection(.enabled)
                    }
                    ForEach(Array(step.jobs.enumerated()), id: \.offset) { _, job in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(job.title).font(.system(size: 13, weight: .medium)).foregroundStyle(Theme.heading)
                            if let d = job.description, !d.isEmpty {
                                Text(d).font(.system(size: 12)).foregroundStyle(Theme.muted)
                            }
                            ForEach(Array(job.commands.enumerated()), id: \.offset) { _, cmd in
                                VStack(alignment: .leading, spacing: 3) {
                                    HStack(alignment: .top, spacing: 6) {
                                        commandIcon(cmd.status)
                                        Text(cmd.command)
                                            .font(.system(size: 12, design: .monospaced))
                                            .foregroundStyle(Theme.body)
                                            .textSelection(.enabled)
                                    }
                                    if let err = cmd.stderr, !err.isEmpty, cmd.status == "failed" {
                                        Text(err)
                                            .font(.system(size: 11, design: .monospaced))
                                            .foregroundStyle(.red)
                                            .lineLimit(6)
                                            .padding(.leading, 18)
                                    }
                                }
                            }
                        }
                    }
                }
                .padding(.leading, 28)
            }
        }
    }

    @ViewBuilder
    private var stepIcon: some View {
        switch status {
        case "running":
            ProgressView().controlSize(.small).frame(width: 20, height: 20)
        case "done":
            Image(systemName: "checkmark.circle.fill").font(.system(size: 18)).foregroundStyle(.green).frame(width: 20, height: 20)
        case "failed":
            Image(systemName: "xmark.circle.fill").font(.system(size: 18)).foregroundStyle(.red).frame(width: 20, height: 20)
        case "partial":
            Image(systemName: "circle.lefthalf.filled").font(.system(size: 18)).foregroundStyle(Theme.muted).frame(width: 20, height: 20)
        default:
            Text("\(index)")
                .font(.system(size: 11, weight: .bold, design: .rounded))
                .frame(width: 20, height: 20)
                .background(Theme.bubble, in: Circle())
                .foregroundStyle(Theme.heading)
        }
    }

    @ViewBuilder
    private func commandIcon(_ status: String?) -> some View {
        switch status {
        case "running": ProgressView().controlSize(.mini).frame(width: 12)
        case "done": Image(systemName: "checkmark.circle.fill").font(.system(size: 12)).foregroundStyle(.green)
        case "failed": Image(systemName: "xmark.circle.fill").font(.system(size: 12)).foregroundStyle(.red)
        default: Image(systemName: "circle").font(.system(size: 12)).foregroundStyle(Theme.muted)
        }
    }
}

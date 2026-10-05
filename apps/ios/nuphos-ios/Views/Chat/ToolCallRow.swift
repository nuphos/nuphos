import SwiftUI

/// One tool call, FlowDown-style: an icon, the label, and a state tint —
/// blue while running, green when done, red on failure, amber while it
/// waits for the user. Tap for parameters and result. Approval buttons and
/// plan cards hang off the row when they apply.
struct ToolCallRow: View {
    let part: ChatPart.ToolPart
    var canDecide: Bool
    let session: ChatSession
    var onOpen: () -> Void
    var onAlwaysAllow: () -> Void

    private var isRunning: Bool { part.state == .inputStreaming || part.state == .inputAvailable || part.state == .approvalResponded }
    private var command: String? { part.command }
    private var planId: String? {
        guard ["plan_create", "database_change_propose"].contains(part.toolName), let out = part.output else { return nil }
        let candidates = [out["planId"], out["id"], out["plan"]?["planId"], out["plan"]?["id"]]
        for c in candidates {
            if let s = c?.stringValue { return s }
            if let n = c?.numberValue { return String(Int(n)) }
        }
        return nil
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Button(action: onOpen) {
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 8) {
                        statusIcon
                        Image(systemName: part.systemImage)
                            .font(Theme.Text.caption.weight(.semibold))
                            .foregroundStyle(Theme.muted)
                        Text(label)
                            .font(Theme.Text.secondary.weight(.medium))
                            .lineLimit(1)
                            .foregroundStyle(Theme.heading)
                            .shimmer(active: isRunning)
                        Spacer(minLength: 8)
                        ElapsedBadge(part: part)
                    }
                    if let command {
                        Text(command)
                            .font(Theme.Text.mono(.caption))
                            .foregroundStyle(Theme.body)
                            .lineLimit(3)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 9)
                .background(tint.opacity(0.10), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(tint.opacity(0.18), lineWidth: 1))
                .contentShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
            .buttonStyle(.plain)

            if part.state == .approvalRequested {
                ApprovalActions(part: part, enabled: canDecide, session: session, onAlwaysAllow: onAlwaysAllow)
            } else if let note = authorizationNote {
                Text(note)
                    .font(Theme.Text.caption)
                    .foregroundStyle(Theme.muted)
                    .padding(.leading, 4)
            }

            if let planId {
                PlanCard(planId: planId, session: session)
            }
        }
    }

    private var label: String {
        if part.state == .inputStreaming {
            return command == nil ? "Preparing tool…" : "Preparing command…"
        }
        return part.displayLabel
    }

    private var tint: Color {
        switch part.state {
        case .inputStreaming, .inputAvailable, .approvalResponded: .blue
        case .approvalRequested: .orange
        case .outputAvailable: .green
        case .outputError: .red
        case .outputDenied: Theme.muted
        }
    }

    @ViewBuilder
    private var statusIcon: some View {
        switch part.state {
        case .inputStreaming, .inputAvailable, .approvalResponded:
            ProgressView().controlSize(.small).tint(tint)
        case .approvalRequested:
            Image(systemName: "hand.raised.fill").foregroundStyle(tint)
        case .outputAvailable:
            Image(systemName: "checkmark.circle.fill").foregroundStyle(tint)
        case .outputError:
            Image(systemName: "xmark.circle.fill").foregroundStyle(tint)
        case .outputDenied:
            Image(systemName: "nosign").foregroundStyle(tint)
        }
    }

    private var authorizationNote: String? {
        if part.state == .approvalResponded || (part.approval?.approved == true && part.isFinished) {
            return "You approved this command."
        }
        if part.state == .outputDenied || part.approval?.approved == false {
            return "You denied this command."
        }
        if let trigger = part.authorization?["triggeredBy"], part.authorization?["decision"]?.stringValue == "allow" {
            switch trigger["kind"]?.stringValue {
            case "read_only": return "Auto-authorized: read-only command."
            case "bypass": return "Auto-authorized: bypass mode."
            case "prior_grant": return "Auto-authorized: previously approved."
            case "rule": return "Auto-authorized by rule: \(trigger["description"]?.stringValue ?? "")"
            case "judge": return "Auto-authorized: \(trigger["reason"]?.stringValue ?? "judged safe")"
            default: return nil
            }
        }
        return nil
    }
}

/// Approve once / for session / always / deny — for a tool call waiting on
/// the user. Only the newest pending call is enabled.
struct ApprovalActions: View {
    let part: ChatPart.ToolPart
    var enabled: Bool
    let session: ChatSession
    var onAlwaysAllow: () -> Void

    private var reason: String? { part.authorization?["reason"]?.stringValue }
    private var isOpenAB: Bool { part.approval?.source == "openab" }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 6) {
                Image(systemName: "lock.shield").font(Theme.Text.caption)
                Text(reason.map { "Authorization required — \($0)" } ?? "Authorization required")
                    .font(Theme.Text.label)
            }
            .foregroundStyle(Theme.body)

            if enabled {
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 8) {
                        Button { session.decide(toolCallId: part.toolCallId, .once) } label: {
                            Text("Approve once").foregroundStyle(Theme.canvas)
                        }
                        .buttonStyle(.borderedProminent)
                        if isOpenAB {
                            Button("Deny", role: .destructive) { session.decide(toolCallId: part.toolCallId, .deny) }
                                .buttonStyle(.bordered)
                        } else {
                            Button("For session") { session.decide(toolCallId: part.toolCallId, .session) }
                                .buttonStyle(.bordered)
                        }
                    }
                    if !isOpenAB {
                        HStack(spacing: 8) {
                            Button("Always allow…", action: onAlwaysAllow)
                                .buttonStyle(.bordered)
                            Button("Deny", role: .destructive) { session.decide(toolCallId: part.toolCallId, .deny) }
                                .buttonStyle(.bordered)
                        }
                    }
                }
                .controlSize(.small)
                .font(Theme.Text.label.weight(.medium))
            } else {
                Text("Waiting on a newer request.")
                    .font(Theme.Text.caption)
                    .foregroundStyle(Theme.muted)
            }
        }
        .padding(12)
        .background(Color.orange.opacity(0.08), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

/// The desktop's tool run: consecutive tool calls shown as one activity
/// line — the latest call's label, its elapsed time, the call count and
/// failures. Opening it lists the calls and the thinking between them in
/// order; a call waiting for authorization opens it by itself.
struct ToolRunView: View {
    let items: [ChatRow.ToolRunItem]
    var live: Bool
    let session: ChatSession
    var onOpen: (ChatPart.ToolPart) -> Void
    var onAlwaysAllow: (ChatPart.ToolPart) -> Void

    @State private var userOpen: Bool?
    @State private var attentionFor: String?

    private var tools: [ChatPart.ToolPart] { items.compactMap(\.tool) }
    private var latest: ChatPart.ToolPart? { tools.last }
    private var needsAttention: Bool { latest?.state == .approvalRequested }
    private var open: Bool { userOpen ?? needsAttention }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let latest {
                Button {
                    withAnimation(.spring(response: 0.4, dampingFraction: 0.9)) { userOpen = !open }
                } label: {
                    HStack(spacing: 6) {
                        ToolLineRow.StatusIcon(part: latest)
                        Text(ToolLineRow.label(for: latest))
                            .lineLimit(1)
                            .foregroundStyle(latest.state == .outputError ? Color.red : Theme.body)
                            .shimmer(active: !latest.isFinished && latest.state != .approvalRequested)
                        ElapsedBadge(part: latest)
                        if tools.count > 1 {
                            Text("· \(tools.count) calls").foregroundStyle(Theme.muted)
                        }
                        let failed = tools.filter { $0.state == .outputError }.count
                        if failed > 0, latest.state != .outputError {
                            Text("· \(failed) failed").foregroundStyle(Color.red.opacity(0.8))
                        }
                        Image(systemName: "chevron.right")
                            .font(Theme.Text.micro.weight(.bold))
                            .foregroundStyle(Theme.muted)
                            .rotationEffect(.degrees(open ? 90 : 0))
                            .opacity(open ? 0.6 : 0.35)
                        Spacer(minLength: 0)
                    }
                    .font(Theme.Text.label)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .id(latest.toolCallId)
                .transition(.opacity)
            }

            if open {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(items) { item in
                        switch item {
                        case .tool(let part, let canDecide):
                            ToolLineRow(part: part, canDecide: canDecide, session: session, onOpen: { onOpen(part) }, onAlwaysAllow: { onAlwaysAllow(part) })
                        case .thinking(_, let part):
                            ReasoningTile(part: part)
                        }
                    }
                }
                .padding(.leading, 12)
                .padding(.top, 8)
                .overlay(alignment: .leading) {
                    Rectangle().fill(Theme.hairline).frame(width: 2).padding(.top, 8).padding(.leading, 3)
                }
            }
        }
        .animation(.snappy(duration: 0.22), value: latest?.toolCallId)
        .onChange(of: latest?.state == .approvalRequested ? latest?.toolCallId : nil) { _, id in
            // A new authorization request overrides whatever the user folded.
            if let id, id != attentionFor { attentionFor = id; userOpen = nil }
        }
    }
}

/// One tool call as a single line: status, label, elapsed. Tap for the
/// input and output. Approval buttons hang off it while it waits.
struct ToolLineRow: View {
    let part: ChatPart.ToolPart
    var canDecide: Bool
    let session: ChatSession
    var onOpen: () -> Void
    var onAlwaysAllow: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button(action: onOpen) {
                HStack(spacing: 6) {
                    StatusIcon(part: part)
                    Text(Self.label(for: part))
                        .lineLimit(1)
                        .foregroundStyle(part.state == .outputError ? Color.red : Theme.body)
                        .shimmer(active: !part.isFinished && part.state != .approvalRequested)
                    ElapsedBadge(part: part)
                    Spacer(minLength: 0)
                }
                .font(Theme.Text.label)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if part.state == .approvalRequested {
                ApprovalActions(part: part, enabled: canDecide, session: session, onAlwaysAllow: onAlwaysAllow)
            } else if let note = Self.decisionNote(for: part) {
                Text(note).font(Theme.Text.caption).italic().foregroundStyle(Theme.muted)
            }
        }
    }

    static func label(for part: ChatPart.ToolPart) -> String {
        if part.state == .inputStreaming {
            return part.command == nil ? "Preparing tool…" : "Preparing command…"
        }
        let raw = part.displayLabel.split(whereSeparator: \.isWhitespace).joined(separator: " ")
        return raw.count > 95 ? String(raw.prefix(95)) + "…" : raw
    }

    static func decisionNote(for part: ChatPart.ToolPart) -> String? {
        if part.state == .outputDenied || part.approval?.approved == false { return "You declined this command." }
        if part.approval?.approved == true { return "You approved this command." }
        return nil
    }

    /// Terminal glyph for command tools, a red cross on failure, nothing
    /// otherwise — the desktop's chrome.
    struct StatusIcon: View {
        let part: ChatPart.ToolPart

        var body: some View {
            if part.state == .outputError {
                Image(systemName: "xmark").font(Theme.Text.micro.weight(.bold)).foregroundStyle(Color.red)
            } else if part.state == .approvalRequested {
                Image(systemName: "hand.raised.fill").font(Theme.Text.micro.weight(.semibold)).foregroundStyle(Color.orange)
            } else if part.isCommandTool {
                Image(systemName: "terminal").font(Theme.Text.micro.weight(.semibold)).foregroundStyle(Theme.muted)
            }
        }
    }
}

/// Seconds a call has been running, ticking while live; final duration
/// once done. Nothing while waiting for approval or after a denial.
struct ElapsedBadge: View {
    let part: ChatPart.ToolPart

    var body: some View {
        if let s = part.startedAt, part.state != .approvalRequested, part.approval?.approved != false {
            if let c = part.completedAt {
                text(max(0, Int((c - s) / 1000)))
            } else if !part.isFinished {
                TimelineView(.periodic(from: .now, by: 1)) { ctx in
                    text(max(0, Int((ctx.date.timeIntervalSince1970 * 1000 - s) / 1000)))
                }
            }
        }
    }

    private func text(_ seconds: Int) -> some View {
        Text("\(seconds)s")
            .font(Theme.Text.mono(.caption2))
            .monospacedDigit()
            .foregroundStyle(Theme.muted.opacity(0.8))
    }
}

/// Finished intermediate work — reasoning and tool calls before the final
/// answer — folded under "Worked for Xs".
struct WorkGroup: View {
    let rows: [ChatRow]
    var duration: TimeInterval?
    var content: (ChatRow) -> AnyView

    @State private var expanded = ProcessInfo.processInfo.arguments.contains("-expand-all")

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(.spring(response: 0.45, dampingFraction: 0.9)) { expanded.toggle() }
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "wrench.and.screwdriver").font(Theme.Text.caption.weight(.semibold))
                    Text(title).font(Theme.Text.label.weight(.medium))
                    Spacer(minLength: 8)
                    Image(systemName: "chevron.right")
                        .font(Theme.Text.micro.weight(.bold))
                        .rotationEffect(.degrees(expanded ? 90 : 0))
                }
                .foregroundStyle(Theme.body)
                .padding(.horizontal, 14)
                .padding(.vertical, 9)
                .background(Theme.chatSurface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .contentShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
            .buttonStyle(.plain)

            Collapsible(expanded: expanded) {
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(rows) { row in content(row) }
                }
                .padding(.leading, 6)
                .padding(.top, 10)
            }
        }
    }

    private var title: String {
        let steps = rows.reduce(0) { $0 + ChatRow.workSteps($1) }
        if let duration, duration >= 1 { return "Worked for \(Self.formatWorkDuration(duration)) · \(steps) steps" }
        return "Worked through \(steps) steps"
    }

    /// `12s`, `3m 5s`, `1h 20m` — the desktop's `formatWorkDuration`.
    static func formatWorkDuration(_ seconds: TimeInterval) -> String {
        let s = Int(seconds)
        if s < 60 { return "\(s)s" }
        if s < 3600 { let m = s / 60, r = s % 60; return r > 0 ? "\(m)m \(r)s" : "\(m)m" }
        let h = s / 3600, m = (s % 3600) / 60
        return m > 0 ? "\(h)h \(m)m" : "\(h)h"
    }
}

/// "Thinking…" / phase text, shimmering while the turn runs — the
/// desktop's `LoadingText`.
struct ActivityRow: View {
    let text: String

    var body: some View {
        Text(text)
            .font(Theme.Text.label)
            .foregroundStyle(Theme.body)
            .contentTransition(.numericText())
            .shimmer(active: true)
            .animation(.snappy, value: text)
    }
}

// MARK: - Shimmer

private struct ShimmerModifier: ViewModifier {
    var active: Bool

    func body(content: Content) -> some View {
        if active {
            TimelineView(.animation(minimumInterval: 1 / 30)) { context in
                let phase = (context.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 1.6)) / 1.6
                content
                    .overlay(
                        LinearGradient(
                            stops: [
                                .init(color: .white.opacity(0), location: max(0, phase - 0.3)),
                                .init(color: .white.opacity(0.9), location: phase),
                                .init(color: .white.opacity(0), location: min(1, phase + 0.3)),
                            ],
                            startPoint: .leading, endPoint: .trailing
                        )
                        .blendMode(.plusLighter)
                        .mask(content)
                    )
            }
        } else {
            content
        }
    }
}

extension View {
    func shimmer(active: Bool) -> some View { modifier(ShimmerModifier(active: active)) }
}

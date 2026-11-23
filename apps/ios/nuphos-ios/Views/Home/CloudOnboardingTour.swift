#if os(iOS)
import SwiftUI
import UserNotifications

/// What a new Nuphos Cloud account sees after agreeing to AI data sharing, while
/// its computer is prepared: Bots, Tasks, the computer they work on, the tools
/// they should reach, notifications, then claiming the computer.
/// Each page plays every time it is shown, and its button appears when it finishes.
/// `-cloud-tour` passes no session and stays offline. The signed-in mobile preview passes one,
/// and only then does Claim talk to the backend.
struct CloudOnboardingTour<More: View>: View {
    @ViewBuilder var more: () -> More
    var onFinish: () -> Void = {}
    var session: AuthSession? = nil

    enum Page: Int, Hashable { case computer = 1, tools, notifications, claim }

    @State private var path: [Page] = []
    @State private var claimed = false
    @State private var started = false
    @State private var deviceTopInset: CGFloat = 60
    @State private var landscape = false
    @AppStorage("onboarding.toolPicks") private var toolPicks = ""
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(more: @escaping () -> More, onFinish: @escaping () -> Void = {}, session: AuthSession? = nil) {
        self.more = more
        self.onFinish = onFinish
        self.session = session
        #if DEBUG
        let start = UserDefaults.standard.integer(forKey: "cloudTourPage")
        if start > 0 {
            _path = State(initialValue: (1...min(start, 4)).compactMap(Page.init(rawValue:)))
        }
        _claimed = State(initialValue: UserDefaults.standard.bool(forKey: "cloudTourClaimed"))
        #endif
    }

    var body: some View {
        tour.modifier(InstaBoxLinks())
            // A screen with its status bar at the side (a folding phone's cover) has no top
            // bar, so the pages add their own room there.
            .environment(\.tourSideStatusBar, deviceTopInset < 20)
            .onGeometryChange(for: CGFloat.self) { $0.safeAreaInsets.top } action: { deviceTopInset = $0 }
            // Too short for a page stacked top to bottom (a phone on its side, or a folding
            // phone's cover): the pages set their copy beside the art instead.
            .environment(\.tourLandscape, landscape)
            .onGeometryChange(for: Bool.self) { $0.size.width > $0.size.height } action: { landscape = $0 }
            // A new run of the tour starts with nothing picked.
            .onAppear {
                guard !started else { return }
                started = true
                toolPicks = ""
                UserDefaults.standard.removeObject(forKey: "onboarding.botFace")
            }
            // Pages keep their layout under the keyboard; a field sits high enough to stay in view.
            .ignoresSafeArea(.keyboard, edges: .bottom)
    }

    @ViewBuilder private var tour: some View {
        if claimed {
            NavigationStack {
                ClaimFlow(animate: !reduceMotion, startClaimed: true, done: {}, skip: onFinish, onFinish: onFinish, session: session)
                    .modifier(TourChrome(more: more))
            }
        } else {
            NavigationStack(path: $path) {
                tourPage(0) { animate, done in
                    AppDemoPage(animate: animate, done: done) { path.append(.computer) }
                }
                .navigationDestination(for: Page.self) { page in
                    switch page {
                    case .computer:
                        tourPage(1) { animate, done in
                            ComputerPage(animate: animate, done: done) { path.append(.tools) }
                        }
                    case .tools:
                        tourPage(2) { animate, done in
                            ToolsPage(animate: animate, done: done, picks: $toolPicks) { path.append(.notifications) }
                        }
                    case .notifications:
                        tourPage(3) { animate, done in
                            NotificationsPage(animate: animate, done: done) { path.append(.claim) }
                        }
                    case .claim:
                        tourPage(4) { animate, done in
                            ClaimFlow(animate: animate, done: done, skip: onFinish, onFinish: onFinish, session: session)
                        }
                    }
                }
            }
        }
    }

    /// A page plays its animation every time it is shown, coming back to it included.
    private func tourPage<Content: View>(
        _ index: Int, @ViewBuilder content: (Bool, @escaping () -> Void) -> Content
    ) -> some View {
        Replay(content: content(!reduceMotion, {}))
            .modifier(TourChrome(more: more))
    }
}

// MARK: - Shared pieces

private let tourPages = 4

private struct TourSideStatusBarKey: EnvironmentKey { static let defaultValue = false }
private struct TourLandscapeKey: EnvironmentKey { static let defaultValue = false }

extension EnvironmentValues {
    /// The screen has no top status bar, so a page's title would sit against the edge.
    fileprivate var tourSideStatusBar: Bool {
        get { self[TourSideStatusBarKey.self] }
        set { self[TourSideStatusBarKey.self] = newValue }
    }

    /// The screen is wide and short, so a page puts its copy and buttons beside the art.
    fileprivate var tourLandscape: Bool {
        get { self[TourLandscapeKey.self] }
        set { self[TourLandscapeKey.self] = newValue }
    }
}

/// Shows the art at its natural size, scaled down only when the room is too small for it.
private struct FitArt<Art: View>: View {
    let art: Art
    @State private var natural: CGSize = .zero

    var body: some View {
        GeometryReader { proxy in
            let scale = natural.height > 0 ? min(1, proxy.size.height / natural.height) : 1
            art
                .frame(width: proxy.size.width)
                .fixedSize(horizontal: false, vertical: true)
                .onGeometryChange(for: CGSize.self) { $0.size } action: { natural = $0 }
                .scaleEffect(scale)
                .frame(width: proxy.size.width, height: proxy.size.height)
        }
    }
}

/// Rebuilds its page each time it appears, so going back to a page plays it again.
private struct Replay<Content: View>: View {
    let content: Content
    @State private var showing = 0

    var body: some View {
        content
            .id(showing)
            .onAppear { showing += 1 }
    }
}

private struct TourChrome<More: View>: ViewModifier {
    var more: () -> More

    func body(content: Content) -> some View {
        content
            .foregroundStyle(Theme.heading)
            .background(Theme.canvas)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { more() } }
    }
}

private struct TourHeader: View {
    let title: LocalizedStringKey
    let detail: LocalizedStringKey

    var body: some View {
        VStack(spacing: 8) {
            Text(title).font(.title2.bold()).accessibilityAddTraits(.isHeader)
            Text(detail).font(.subheadline).foregroundStyle(Theme.body).tint(Theme.heading)
        }
        .multilineTextAlignment(.center)
        .fixedSize(horizontal: false, vertical: true)
    }
}

private struct PageDots: View {
    let current: Int

    var body: some View {
        HStack(spacing: 6) {
            ForEach(0..<tourPages, id: \.self) { index in
                Capsule().fill(index == current ? Theme.heading : Theme.muted.opacity(0.3))
                    .frame(width: index == current ? 14 : 6, height: 6)
            }
        }
        .accessibilityHidden(true)
    }
}

/// Fades in and rises when the page has played.
private struct Reveal: ViewModifier {
    let shown: Bool

    func body(content: Content) -> some View {
        content
            .opacity(shown ? 1 : 0)
            .offset(y: shown ? 0 : 10)
            .allowsHitTesting(shown)
    }
}

/// Title and detail, the art, then the button that fades in when the page has played.
private struct TourLayout<Art: View, Actions: View>: View {
    let title: LocalizedStringKey
    let detail: LocalizedStringKey
    var dots: Int?
    var revealed: Bool
    /// Keeps the art in place while the title changes length.
    var headerHeight: CGFloat?
    @ViewBuilder var art: () -> Art
    @ViewBuilder var actions: () -> Actions
    @Environment(\.tourSideStatusBar) private var sideStatusBar
    @Environment(\.tourLandscape) private var landscape

    var body: some View {
        if landscape {
            HStack(spacing: 32) {
                VStack(spacing: 0) {
                    Spacer(minLength: 12)
                    TourHeader(title: title, detail: detail)
                    Spacer(minLength: 16)
                    footer
                }
                .frame(maxWidth: 340)
                FitArt(art: art()).padding(.vertical, 12)
            }
            .padding(.horizontal, 24)
            .frame(maxWidth: 900)
            .frame(maxWidth: .infinity)
        } else {
            VStack(spacing: 0) {
                TourHeader(title: title, detail: detail)
                    .frame(minHeight: headerHeight, alignment: .top)
                    .padding(.top, sideStatusBar ? 40 : 12)
                // Above the dots: art may reach past its own space, as the Dock does.
                FitArt(art: art()).padding(.vertical, 16).zIndex(1)
                footer
            }
            .padding(.horizontal, 24)
            .frame(maxWidth: 480)
            .frame(maxWidth: .infinity)
        }
    }

    private var footer: some View {
        VStack(spacing: 16) {
            if let dots { PageDots(current: dots) }
            actions().modifier(Reveal(shown: revealed))
        }
        .padding(.bottom, 12)
    }
}

private func primaryButton(_ title: LocalizedStringKey, action: @escaping () -> Void) -> some View {
    Button(action: action) { Text(title).frame(maxWidth: .infinity) }
        .buttonStyle(DesignPrimaryButtonStyle())
}

/// Plays `steps` in order, then reveals the page's button. Without motion it jumps to the end.
/// `stopped` ends the play early, when the user takes over.
@MainActor
private func play(
    _ animate: Bool, steps: [(Double, Animation?, () -> Void)],
    stopped: @escaping () -> Bool = { false }, finish: @escaping () -> Void
) async {
    if !animate {
        for step in steps { step.2() }
        finish()
        return
    }
    for (delay, animation, change) in steps {
        do { try await Task.sleep(for: .seconds(delay)) } catch { return }
        if stopped() { return }
        withAnimation(animation) { change() }
    }
    do { try await Task.sleep(for: .seconds(0.2)) } catch { return }
    if stopped() { return }
    withAnimation(.easeOut(duration: 0.35)) { finish() }
}

private let deskTurn = Animation.timingCurve(0.65, 0, 0.35, 1, duration: 0.92)
private let slap = Animation.spring(response: 0.32, dampingFraction: 0.62)

/// A Bot's face, from the same set the app gives its Bots.
private struct BotFace: View {
    let face: String
    var size: CGFloat

    var body: some View {
        Image(BotAvatars.asset(named: face) ?? "bot-avatar-09-frida")
            .resizable().scaledToFit()
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}

/// The app's current Home Screen icon.
private struct AppIconImage: View {
    var size: CGFloat

    var body: some View {
        Image("AppIconPreview-\(AppIconPicker.current)")
            .resizable().scaledToFit()
            .frame(width: size, height: size)
            .clipShape(RoundedRectangle(cornerRadius: size * 0.225, style: .continuous))
            .accessibilityHidden(true)
    }
}

// MARK: - 1 Bots and Tasks

/// A small copy of the app's home: Bots (with a team's channel among them) and
/// Tasks, as its own tab bar shows them. The tabs can be tapped.
private struct AppDemoPage: View {
    let animate: Bool
    let done: () -> Void
    let next: () -> Void

    enum Tab { case bots, tasks, inbox }

    @State private var tab = Tab.bots
    @State private var rows = 0
    @State private var revealed = false
    @State private var tookOver = false

    private struct Row {
        enum Avatar { case bot(String), channel, task(String) }
        let avatar: Avatar
        let title: String
        let detail: String
        var badge: LocalizedStringKey?
        var running = false
        var time = ""
    }

    private static let bots = [
        Row(avatar: .bot("09-frida"), title: "Frida", detail: "Drafted replies to 3 emails", time: "9:41"),
        Row(avatar: .channel, title: "launch-planning", detail: "Leonardo: Meeting notes are posted for everyone", badge: "Team", time: "9:30"),
        Row(avatar: .bot("02-leonardo"), title: "Leonardo", detail: "Your 2 PM with Acme moved to 3 PM", time: "9:12"),
    ]

    private static let tasks = [
        Row(avatar: .task("claude-code"), title: "Summarize today’s standup", detail: "Done · 5 key points", time: "9:40"),
        Row(avatar: .task("codex"), title: "Find a time for next week’s review", detail: "Checking 4 calendars", running: true),
        Row(avatar: .task("grok"), title: "Clean up my inbox", detail: "Archived 42 newsletters", running: true),
    ]

    private static let inbox = [
        Row(avatar: .bot("09-frida"), title: "Send 3 replies?", detail: "Frida needs your answer", badge: "Reply", time: "9:41"),
        Row(avatar: .bot("02-leonardo"), title: "Move Acme call to 3 PM?", detail: "Leonardo needs your answer", badge: "Reply", time: "9:12"),
    ]

    var body: some View {
        TourLayout(
            title: "Bots, Tasks, and your Inbox",
            detail: "Bots are teammates that remember your work, alone or with your team in a channel. Tasks take one-off jobs to Claude Code, Codex, or Grok Build. Anything that needs you lands in your Inbox.",
            dots: 0, revealed: revealed
        ) {
            VStack(spacing: 0) {
                VStack(spacing: 4) {
                    let list = switch tab {
                    case .bots: Self.bots
                    case .tasks: Self.tasks
                    case .inbox: Self.inbox
                    }
                    ForEach(Array(list.enumerated()), id: \.element.title) { index, row in
                        if rows > index {
                            rowView(row).transition(.opacity.combined(with: .move(edge: .bottom)))
                        }
                    }
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 12).padding(.top, 14)
                .frame(maxHeight: .infinity, alignment: .top)
                Divider()
                tabBar
            }
            .frame(width: 310, height: 270)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 24))
            .clipShape(RoundedRectangle(cornerRadius: 24))
            .shadow(color: .black.opacity(0.08), radius: 16, y: 6)
        } actions: {
            primaryButton("Continue", action: next)
        }
        .task { await run() }
    }

    private var tabBar: some View {
        HStack {
            tabButton(.bots, title: "Bots", image: "home-tab-bots")
            tabButton(.tasks, title: "Tasks", image: "home-tab-tasks")
            tabButton(.inbox, title: "Inbox", image: "home-tab-inbox", count: 2)
        }
        .padding(.vertical, 8)
    }

    private func tabButton(_ value: Tab, title: LocalizedStringKey, image: String, count: Int = 0) -> some View {
        let on = tab == value
        return Button {
            tookOver = true
            withAnimation(.easeOut(duration: 0.25)) {
                tab = value
                rows = 3
                revealed = true
            }
            done()
        } label: {
            VStack(spacing: 3) {
                Image(image).renderingMode(.template).resizable().scaledToFit().frame(width: 20, height: 20)
                    .overlay(alignment: .topTrailing) {
                        if count > 0 {
                            Text("\(count)").font(.system(size: 9, weight: .bold)).foregroundStyle(.white)
                                .frame(minWidth: 14, minHeight: 14)
                                .background(Color.red, in: Capsule())
                                .offset(x: 8, y: -5)
                        }
                    }
                Text(title).font(.system(size: 10, weight: .medium))
            }
            .foregroundStyle(on ? Theme.heading : Theme.muted)
            .frame(maxWidth: .infinity)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    private func rowView(_ row: Row) -> some View {
        HStack(spacing: 10) {
            avatar(row.avatar).frame(width: 38, height: 38)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    if case .channel = row.avatar {
                        Text("#").font(.subheadline.weight(.semibold)).foregroundStyle(Theme.muted)
                            .padding(.trailing, -4)
                    }
                    Text(row.title).font(.subheadline.weight(.semibold)).lineLimit(1)
                    if let badge = row.badge {
                        Text(badge).font(.caption2.weight(.semibold)).foregroundStyle(Theme.muted)
                            .padding(.horizontal, 6).padding(.vertical, 1)
                            .background(Theme.canvas, in: Capsule())
                    }
                    Spacer(minLength: 4)
                    if row.running {
                        ProgressView().controlSize(.mini)
                    } else {
                        Text(row.time).font(.caption2).foregroundStyle(Theme.muted)
                    }
                }
                Text(row.detail).font(.footnote).foregroundStyle(Theme.muted).lineLimit(1)
            }
        }
        .padding(.vertical, 8)
    }

    @ViewBuilder private func avatar(_ avatar: Row.Avatar) -> some View {
        switch avatar {
        case .bot(let face):
            BotFace(face: face, size: 38)
        case .task(let runtime):
            RuntimeMark(runtime: runtime, size: 20)
                .frame(width: 38, height: 38)
                .background(Theme.canvas, in: Circle())
        case .channel:
            // Two teammates and a Bot, as a channel's members stack.
            ZStack {
                Circle().fill(Color(hex: 0xC9D7F2)).frame(width: 24, height: 24)
                    .overlay(Text("A").font(.caption2.weight(.bold)).foregroundStyle(Color(hex: 0x33456B)))
                    .offset(x: -8, y: -7)
                Circle().fill(Color(hex: 0xF2D4C2)).frame(width: 24, height: 24)
                    .overlay(Text("M").font(.caption2.weight(.bold)).foregroundStyle(Color(hex: 0x6B3E28)))
                    .offset(x: 8, y: -7)
                BotFace(face: "02-leonardo", size: 24)
                    .background(Circle().fill(Theme.surface).padding(-2))
                    .offset(y: 8)
            }
        }
    }

    private func run() async {
        tab = .bots
        rows = 0
        revealed = false
        tookOver = false
        await play(animate, steps: [
            (0.3, .spring(response: 0.4, dampingFraction: 0.85), { rows = 1 }),
            (0.2, .spring(response: 0.4, dampingFraction: 0.85), { rows = 2 }),
            (0.2, .spring(response: 0.4, dampingFraction: 0.85), { rows = 3 }),
            (1.0, .easeOut(duration: 0.2), { tab = .tasks; rows = 0 }),
            (0.15, .spring(response: 0.4, dampingFraction: 0.85), { rows = 1 }),
            (0.2, .spring(response: 0.4, dampingFraction: 0.85), { rows = 2 }),
            (0.2, .spring(response: 0.4, dampingFraction: 0.85), { rows = 3 }),
            (1.0, .easeOut(duration: 0.2), { tab = .inbox; rows = 0 }),
            (0.15, .spring(response: 0.4, dampingFraction: 0.85), { rows = 1 }),
            (0.2, .spring(response: 0.4, dampingFraction: 0.85), { rows = 2 }),
        ], stopped: { tookOver }) { revealed = true; done() }
    }
}

private struct TourTypingDots: View {
    @State private var phase = 0.0

    var body: some View {
        HStack(spacing: 4) {
            ForEach(0..<3, id: \.self) { index in
                Circle().frame(width: 5, height: 5)
                    .opacity(0.3 + 0.7 * max(0, sin(phase - Double(index) * 0.6)))
            }
        }
        .foregroundStyle(Theme.muted)
        .frame(height: 16)
        .onAppear { withAnimation(.linear(duration: 1).repeatForever(autoreverses: false)) { phase = .pi * 2 } }
    }
}

// MARK: - 2 The computer

/// A chat with a Bot whose Dock, its computer's tabs, slides up while it works:
/// the same Work tools sheet a conversation opens. The Dock button and its tabs
/// can be tapped.
private struct ComputerPage: View {
    let animate: Bool
    let done: () -> Void
    let next: () -> Void

    enum DockTab: Int, CaseIterable { case mail, calendar }

    @State private var asked = false
    @State private var working = false
    @State private var dock = false
    @State private var tab = DockTab.mail
    @State private var typed = 0
    @State private var booked = false
    @State private var answered = false
    @State private var pulse = false
    @State private var revealed = false
    @State private var tookOver = false

    private static let reply = "Thursday at 3 PM works for us. I’ll send the agenda tomorrow."

    var body: some View {
        TourLayout(
            title: "Your Bots have their own computer",
            detail: "A free cloud computer from us, or your own Mac or PC. Either way they keep working when your phone is locked, and you can open the Dock anytime to see what they’re doing.",
            dots: 1, revealed: revealed
        ) {
            ZStack(alignment: .bottom) {
                chat
                    .frame(width: 300, height: 310)
                    .background(Theme.surface)
                    .clipShape(RoundedRectangle(cornerRadius: 24))
                    .shadow(color: .black.opacity(0.08), radius: 16, y: 6)
                // Larger than the chat, as the Dock is a computer of its own.
                if dock {
                    dockSheet
                        .frame(width: 340, height: 300)
                        .offset(y: 44)
                        // Slides, never fades: a see-through Dock would show the chat through it.
                        .transition(.offset(y: 1000))
                        // Above the chat while it leaves too, not tucked behind it.
                        .zIndex(1)
                }
            }
            .frame(width: 340, height: 330)
        } actions: {
            primaryButton("Next", action: next)
        }
        .task { await run() }
    }

    /// The user's tap ends the play. The chat fills in only once the Dock is out of its way.
    private func takeOver(_ change: () -> Void) {
        let first = !tookOver
        if first {
            tookOver = true
            typed = Self.reply.count; booked = true
        }
        change()
        guard first else { return }
        Task {
            if dock { try? await Task.sleep(for: .milliseconds(450)) }
            withAnimation(.easeOut(duration: 0.3)) {
                asked = true; working = true; answered = true
                revealed = true
            }
            done()
        }
    }

    private var chat: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                BotFace(face: "09-frida", size: 28)
                Text("Frida").font(.subheadline.weight(.semibold))
                Spacer()
                Button {
                    takeOver { withAnimation(.snappy) { dock.toggle() } }
                } label: {
                    Image("lucide-monitor").renderingMode(.template).resizable().scaledToFit()
                        .frame(width: 16, height: 16)
                        .foregroundStyle(Theme.heading)
                        .frame(width: 32, height: 32)
                        .background(Circle().fill(Theme.canvas))
                        .overlay(Circle().strokeBorder(Theme.heading.opacity(pulse ? 0.6 : 0), lineWidth: 2).scaleEffect(pulse ? 1.25 : 1))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Work tools")
            }
            Divider()
            Spacer(minLength: 0)
            if asked {
                Text("Find a time with Dana next week and reply to her email.")
                    .font(.footnote).foregroundStyle(Theme.canvas)
                    .padding(.horizontal, 12).padding(.vertical, 8)
                    .background(Theme.heading, in: RoundedRectangle(cornerRadius: 16))
                    .frame(maxWidth: .infinity, alignment: .trailing)
                    .padding(.leading, 40)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
            if working { botLine("On it. I’ll check both calendars.") }
            if answered { botLine("Booked Thursday at 3 PM and replied to Dana.") }
            Text("Message Frida").font(.footnote).foregroundStyle(Theme.muted)
                .padding(.horizontal, 12).frame(maxWidth: .infinity, minHeight: 34, alignment: .leading)
                .background(Theme.canvas, in: Capsule())
        }
        .padding(14)
    }

    private func botLine(_ text: String) -> some View {
        Text(text)
            .font(.footnote)
            .padding(.horizontal, 12).padding(.vertical, 8)
            .background(Theme.canvas, in: RoundedRectangle(cornerRadius: 16))
            .padding(.trailing, 40)
            .transition(.move(edge: .bottom).combined(with: .opacity))
    }

    /// As DockPanel draws it: a "Dock" header, the computer's tabs as chips, then the front tab.
    private var dockSheet: some View {
        VStack(spacing: 0) {
            Capsule().fill(Theme.muted.opacity(0.35)).frame(width: 34, height: 4).padding(.top, 6)
            HStack {
                Text("Dock").font(.headline)
                Spacer()
                Button {
                    takeOver { withAnimation(.snappy) { dock = false } }
                } label: {
                    Image("lucide-x").renderingMode(.template).resizable().scaledToFit().frame(width: 16, height: 16)
                        .foregroundStyle(Theme.body).frame(width: 40, height: 40)
                        .background(Circle().fill(Theme.canvas))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Close")
            }
            .padding(.horizontal, 16).padding(.vertical, 6)
            HStack(spacing: 6) {
                chip(.mail, title: "Mail · Re: Q3 kickoff")
                chip(.calendar, title: "Calendar")
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 12).padding(.bottom, 8)
            desktop
        }
        .background(Theme.surface)
        .clipShape(UnevenRoundedRectangle(topLeadingRadius: 18, topTrailingRadius: 18))
        .shadow(color: .black.opacity(0.15), radius: 12, y: -2)
    }

    private func chip(_ value: DockTab, title: String) -> some View {
        let front = tab == value
        return Button {
            takeOver { withAnimation(.easeInOut(duration: 0.2)) { tab = value } }
        } label: {
            HStack(spacing: 5) {
                Image("lucide-globe").renderingMode(.template).resizable().scaledToFit().frame(width: 11, height: 11)
                Text(title).font(.caption.weight(.medium)).lineLimit(1)
            }
            .foregroundStyle(front ? Theme.heading : Theme.body)
            .padding(.horizontal, 10).frame(height: 28)
            .background(Capsule().fill(front ? Theme.canvas : Theme.canvas.opacity(0.5)))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(front ? .isSelected : [])
    }

    /// The Bot's computer: its desktop, with the front tab's window on top.
    private var desktop: some View {
        ZStack(alignment: .topLeading) {
            LinearGradient(colors: [Color(hex: 0xF3D9B8), Color(hex: 0xC9B6E4), Color(hex: 0x9FB8E8)],
                           startPoint: .topLeading, endPoint: .bottomTrailing)
            window("Calendar", front: tab == .calendar) { calendarPage }
                .frame(width: 240, height: 170)
                .offset(x: 84, y: 40)
                .zIndex(tab == .calendar ? 1 : 0)
            window("Mail", front: tab == .mail) { mailPage }
                .frame(width: 236, height: 160)
                .offset(x: 14, y: 14)
                .zIndex(tab == .mail ? 1 : 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .clipped()
        .environment(\.colorScheme, .light)
    }

    private func window<Content: View>(_ title: String, front: Bool, @ViewBuilder content: () -> Content) -> some View {
        VStack(spacing: 0) {
            HStack(spacing: 4) {
                ForEach([0xFF5F57, 0xFEBC2E, 0x28C840], id: \.self) { color in
                    Circle().fill(Color(hex: UInt32(color)).opacity(front ? 1 : 0.4)).frame(width: 7, height: 7)
                }
                Text(title).font(.caption2.weight(.semibold)).foregroundStyle(.black.opacity(front ? 0.75 : 0.4))
                    .frame(maxWidth: .infinity)
                Color.clear.frame(width: 29, height: 1)
            }
            .padding(.horizontal, 8).frame(height: 22)
            .background(Color(hex: 0xECEAE6))
            content()
                .padding(10)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                .background(.white)
        }
        .foregroundStyle(.black)
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .shadow(color: .black.opacity(front ? 0.25 : 0.1), radius: front ? 10 : 4, y: front ? 5 : 2)
    }

    private var mailPage: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Re: Q3 kickoff").font(.footnote.weight(.semibold))
            Text("To: Dana Chen").font(.caption).foregroundStyle(.black.opacity(0.45))
            Divider()
            Text("Hi Dana,").font(.caption)
            Text(String(Self.reply.prefix(typed)))
                .font(.caption)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var calendarPage: some View {
        HStack(alignment: .top, spacing: 6) {
            ForEach(["Tue", "Wed", "Thu", "Fri"], id: \.self) { day in
                VStack(spacing: 4) {
                    Text(day).font(.caption2.weight(.semibold)).foregroundStyle(.black.opacity(0.45))
                    ZStack(alignment: .top) {
                        RoundedRectangle(cornerRadius: 4).fill(Color(hex: 0xF4F2EF)).frame(height: 105)
                        if day == "Wed" {
                            event("1:1 with Sam", color: 0xA7B4C8).offset(y: 14)
                        }
                        if day == "Thu" && booked {
                            event("Q3 review\n3–4 PM", color: 0x5B7BD5)
                                .offset(y: 42)
                                .transition(.move(edge: .top).combined(with: .opacity))
                        }
                    }
                }
            }
        }
    }

    private func event(_ text: String, color: UInt32) -> some View {
        Text(text)
            .font(.system(size: 9, weight: .semibold))
            .foregroundStyle(.white)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity, minHeight: 30)
            .background(Color(hex: color), in: RoundedRectangle(cornerRadius: 4))
            .padding(.horizontal, 2)
    }

    private func run() async {
        asked = false; working = false; dock = false; tab = .mail
        typed = 0; booked = false; answered = false; pulse = false
        revealed = false; tookOver = false
        var steps: [(Double, Animation?, () -> Void)] = [
            (0.4, .spring(response: 0.35, dampingFraction: 0.8), { asked = true }),
            (0.6, .easeOut(duration: 0.25), { working = true }),
            (0.5, .easeInOut(duration: 0.3), { pulse = true }),
            (0.3, .snappy, { pulse = false; dock = true }),
        ]
        for count in stride(from: 5, through: Self.reply.count, by: 5) {
            steps.append((0.06, nil, { typed = count }))
        }
        steps += [
            (0.1, nil, { typed = Self.reply.count }),
            (0.6, .easeInOut(duration: 0.2), { tab = .calendar }),
            (0.4, .spring(response: 0.45, dampingFraction: 0.7), { booked = true }),
            (0.9, .snappy, { dock = false }),
            (0.4, .spring(response: 0.35, dampingFraction: 0.8), { answered = true }),
        ]
        await play(animate, steps: steps, stopped: { tookOver }) { revealed = true; done() }
    }
}

// MARK: - 4 Tools

private struct Tool: Identifiable {
    let key: String
    let title: String
    let logo: String
    var id: String { key }
}

private struct ToolGroup: Identifiable {
    let title: LocalizedStringKey
    let tools: [Tool]
    var id: String { tools.map(\.key).joined() }
}

/// The connectors bound by signing in to the provider, which a phone can finish by
/// itself, in Desktop's categories and order (connectorCategories.ts, personal first).
/// Ones that need keys, a console or a computer are left for the Connectors page.
private let toolGroups = [
    ToolGroup(title: "Personal", tools: [
        Tool(key: "gmail", title: "Gmail", logo: "logo-gmail"),
        Tool(key: "google-drive", title: "Google Drive", logo: "logo-google-drive"),
        Tool(key: "google-calendar", title: "Google Calendar", logo: "logo-google-calendar"),
    ]),
    ToolGroup(title: "Communication", tools: [
        Tool(key: "slack", title: "Slack", logo: "logo-slack"),
        Tool(key: "discord", title: "Discord", logo: "logo-discord"),
    ]),
    ToolGroup(title: "Projects & tasks", tools: [
        Tool(key: "linear", title: "Linear", logo: "logo-linear"),
        Tool(key: "jira", title: "Jira", logo: "logo-jira"),
        Tool(key: "asana", title: "Asana", logo: "logo-asana"),
        Tool(key: "trello", title: "Trello", logo: "logo-trello"),
    ]),
    ToolGroup(title: "Docs & knowledge", tools: [
        Tool(key: "plaud", title: "Plaud", logo: "logo-plaud"),
    ]),
    ToolGroup(title: "Code", tools: [
        Tool(key: "github", title: "GitHub", logo: "logo-github"),
        Tool(key: "gitlab", title: "GitLab", logo: "logo-gitlab"),
    ]),
    ToolGroup(title: "Cloud", tools: [
        Tool(key: "cloudflare", title: "Cloudflare", logo: "logo-cloudflare"),
    ]),
    ToolGroup(title: "Monitoring", tools: [
        Tool(key: "sentry", title: "Sentry", logo: "logo-sentry"),
        Tool(key: "posthog", title: "PostHog", logo: "logo-posthog"),
    ]),
]

private struct ToolsPage: View {
    let animate: Bool
    let done: () -> Void
    @Binding var picks: String
    let next: () -> Void

    @State private var shown = 0
    @State private var revealed = false

    private var selected: [String] { picks.split(separator: ",").map(String.init) }
    @Environment(\.tourSideStatusBar) private var sideStatusBar
    @Environment(\.tourLandscape) private var landscape

    private var header: some View {
        TourHeader(
            title: "What should your Bot be able to reach?",
            detail: "Pick the tools you use. Your Bot will help you connect them in your first chat."
        )
    }

    private var footer: some View {
        VStack(spacing: 16) {
            PageDots(current: 2)
            primaryButton(selected.isEmpty ? "Skip" : "Continue", action: next).modifier(Reveal(shown: revealed))
        }
    }

    var body: some View {
        Group {
            if landscape {
                HStack(spacing: 32) {
                    VStack(spacing: 0) {
                        Spacer(minLength: 12)
                        header
                        Spacer(minLength: 16)
                        footer.padding(.bottom, 12)
                    }
                    .frame(maxWidth: 340)
                    ScrollView { tools.padding(.vertical, 16) }
                }
                .padding(.horizontal, 24)
                .frame(maxWidth: 900)
            } else {
                portrait
            }
        }
        .frame(maxWidth: .infinity)
        .task {
            var steps: [(Double, Animation?, () -> Void)] = [(0.2, nil, {})]
            for _ in toolGroups { steps.append((0.12, .easeOut(duration: 0.35), { shown += 1 })) }
            await play(animate, steps: steps) { revealed = true; done() }
        }
    }

    private var portrait: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(spacing: 24) {
                    header.padding(.top, sideStatusBar ? 40 : 12)
                    tools
                }
                .padding(.horizontal, 24)
                .padding(.bottom, 24)
                .frame(maxWidth: 480)
                .frame(maxWidth: .infinity)
            }
            footer
                .padding(.horizontal, 24)
                .padding(.vertical, 12)
                .frame(maxWidth: 480)
        }
    }

    private var tools: some View {
                    VStack(alignment: .leading, spacing: 20) {
                        ForEach(Array(toolGroups.enumerated()), id: \.element.id) { index, group in
                            VStack(alignment: .leading, spacing: 10) {
                                Text(group.title).font(.footnote.weight(.semibold)).foregroundStyle(Theme.muted)
                                FlowLayout(spacing: 8) {
                                    ForEach(group.tools) { tool in chip(tool) }
                                }
                            }
                            .opacity(shown > index ? 1 : 0)
                            .offset(y: shown > index ? 0 : 12)
                        }
                        // The rest need keys, a console or a computer to set up.
                        Label("AWS, Grafana, databases, and 20+ more connect from Nuphos on your computer.",
                              systemImage: "laptopcomputer")
                            .font(.footnote)
                            .foregroundStyle(Theme.muted)
                            .padding(.top, 4)
                            .opacity(shown >= toolGroups.count ? 1 : 0)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func chip(_ connector: Tool) -> some View {
        let on = selected.contains(connector.key)
        return Button {
            var set = Set(selected)
            if on { set.remove(connector.key) } else { set.insert(connector.key) }
            // Not animated: a chip that widens can wrap its row, and the rows must not slide over each other.
            picks = set.sorted().joined(separator: ",")
        } label: {
            HStack(spacing: 8) {
                // AWS's mark is a wordmark, so it gets more width than the square marks.
                Image(connector.logo).resizable().scaledToFit()
                    .frame(width: connector.key == "aws" ? 28 : 18, height: connector.key == "aws" ? 22 : 18)
                Text(connector.title).font(.subheadline).lineLimit(1)
                if on { Image(systemName: "checkmark").font(.caption.bold()) }
            }
            .padding(.horizontal, 12)
            .frame(height: 38)
            .background(Theme.surface, in: Capsule())
            .overlay(Capsule().strokeBorder(on ? Theme.heading : Theme.muted.opacity(0.18), lineWidth: on ? 1.5 : 1))
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(connector.title)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

// MARK: - 5 Notifications

private struct NotificationsPage: View {
    @MainActor
    private func readPermission() async {
        permission = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
    }

    let animate: Bool
    let done: () -> Void
    let next: () -> Void

    @State private var activity = false
    @State private var count = 0
    @State private var revealed = false
    /// What iOS has: it asks only once, so once turned off they can only be turned on in Settings.
    @State private var permission: UNAuthorizationStatus?
    @Environment(\.openURL) private var openURL
    @Environment(\.scenePhase) private var scenePhase

    /// As the Live Activity's card shows them (TurnCard).
    private static let card = TurnActivityAttributes.ContentState(
        sessions: [
            .init(id: "1", teamId: "t", title: "Find a time for next week’s review", phase: .running),
            .init(id: "2", teamId: "t", title: "Summarize today’s standup", phase: .done),
        ],
        more: 0, active: 1)

    var body: some View {
        TourLayout(
            title: "Know when your Bot needs you",
            detail: "Follow running work on your Lock Screen, and get a notification when it’s done or needs an answer.",
            dots: 3, revealed: revealed
        ) {
            VStack(spacing: 8) {
                VStack(spacing: 0) {
                    Text("Friday, November 20").font(.footnote.weight(.semibold)).foregroundStyle(.white.opacity(0.8))
                    Text("9:41").font(.system(size: 52, weight: .semibold, design: .rounded)).foregroundStyle(.white)
                }
                .padding(.top, 16).padding(.bottom, 8)
                if activity {
                    TurnCard(card: Self.card)
                        .background(.black, in: RoundedRectangle(cornerRadius: 22))
                        .transition(.move(edge: .top).combined(with: .opacity))
                }
                if count > 1 {
                    notification(title: "Summarize today’s standup", body: "Done. 5 key points and 2 action items.") {
                        AppIconImage(size: 32)
                    }
                }
                if count > 0 {
                    notification(title: "Frida", body: "I drafted replies to 3 emails. Want to review them before I send?") {
                        BotFace(face: "09-frida", size: 32)
                            .overlay(alignment: .bottomTrailing) { AppIconImage(size: 14).offset(x: 3, y: 3) }
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(10)
            .frame(width: 290, height: 400)
            .background(
                LinearGradient(colors: [Color(hex: 0x3B3A48), Color(hex: 0x6E6A7C), Color(hex: 0xB8A99A)],
                               startPoint: .top, endPoint: .bottom),
                in: RoundedRectangle(cornerRadius: 32))
            .clipShape(RoundedRectangle(cornerRadius: 32))
            .accessibilityElement(children: .combine)
        } actions: {
            switch permission {
            case .authorized, .provisional, .ephemeral:
                VStack(spacing: 8) {
                    Label("Notifications are on", systemImage: "checkmark.circle.fill")
                        .font(.footnote).foregroundStyle(Theme.muted)
                    primaryButton("Continue", action: next)
                }
            default:
                VStack(spacing: 8) {
                    if permission == .denied {
                        Text("Notifications are off for Nuphos. Turn them on in Settings.")
                            .font(.footnote).foregroundStyle(Theme.muted)
                            .multilineTextAlignment(.center)
                    }
                    HStack(spacing: 12) {
                        Button(action: next) {
                            Text("Later").font(.body.weight(.semibold)).frame(width: 96, height: 48)
                                .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.button))
                                .overlay(RoundedRectangle(cornerRadius: Theme.Radius.button).strokeBorder(Theme.muted.opacity(0.2)))
                        }
                        .buttonStyle(.plain)
                        if permission == .denied {
                            primaryButton("Open Settings") {
                                if let url = URL(string: UIApplication.openNotificationSettingsURLString) { openURL(url) }
                            }
                        } else {
                            primaryButton("Turn On") {
                                Task {
                                    let granted = (try? await UNUserNotificationCenter.current()
                                        .requestAuthorization(options: [.alert, .sound, .badge])) ?? false
                                    await readPermission()
                                    if granted { next() }
                                }
                            }
                        }
                    }
                }
            }
        }
        .task { await readPermission() }
        // Back from Settings, show what changed there.
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await readPermission() } }
        }
        .task {
            await play(animate, steps: [
                (0.6, .spring(response: 0.5, dampingFraction: 0.85), { activity = true }),
                (1.0, .spring(response: 0.45, dampingFraction: 0.8), { count = 1 }),
                (1.0, .spring(response: 0.45, dampingFraction: 0.8), { count = 2 }),
            ]) { revealed = true; done() }
        }
    }

    private func notification<Icon: View>(
        title: String, body: String, @ViewBuilder icon: () -> Icon
    ) -> some View {
        HStack(alignment: .center, spacing: 10) {
            icon()
            VStack(alignment: .leading, spacing: 1) {
                HStack {
                    Text(title).font(.footnote.weight(.semibold)).lineLimit(1)
                    Spacer()
                    Text("now").font(.caption2).foregroundStyle(.secondary)
                }
                Text(body).font(.footnote).fixedSize(horizontal: false, vertical: true)
            }
        }
        .foregroundStyle(.black)
        .padding(12)
        .background(.white.opacity(0.85), in: RoundedRectangle(cornerRadius: 20))
        .environment(\.colorScheme, .light)
        .transition(.move(edge: .top).combined(with: .opacity))
    }
}

// MARK: - 5 Claim

/// What InstaBox is, when its name is tapped: a short panel, a third of the screen.
private struct InstaBoxInfo: View {
    @Environment(\.openURL) private var openURL
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 10) {
                Image("InstaBoxMark").resizable().renderingMode(.template).scaledToFit()
                    .frame(width: 18, height: 18)
                    .foregroundStyle(.white)
                    .frame(width: 36, height: 36)
                    .background(.black, in: RoundedRectangle(cornerRadius: 9))
                Text("InstaBox").font(.title3.bold())
            }
            Text("InstaBox runs cloud computers for AI agents. Your Nuphos computer is one of them, so your Bots keep their files and tools in one place and keep working when your phone is locked.")
                .font(.subheadline).foregroundStyle(Theme.body)
                .fixedSize(horizontal: false, vertical: true)
            Button {
                dismiss()
                openURL(URL(string: "https://instabox.sh")!)
            } label: {
                Label("Visit instabox.sh", systemImage: "arrow.up.right").font(.subheadline.weight(.semibold))
            }
            .tint(Theme.heading)
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .foregroundStyle(Theme.heading)
        .presentationDetents([.fraction(0.34)])
        .presentationDragIndicator(.visible)
    }
}

/// Opens the InstaBox panel for links to instabox.sh in the tour's text.
private struct InstaBoxLinks: ViewModifier {
    @State private var showing = false

    func body(content: Content) -> some View {
        content
            .environment(\.openURL, OpenURLAction { url in
                guard url.host() == "instabox.sh" else { return .systemAction }
                showing = true
                return .handled
            })
            .sheet(isPresented: $showing) {
                // Inside the panel, the link goes to the website itself.
                InstaBoxInfo().environment(\.openURL, OpenURLAction { _ in .systemAction })
            }
    }
}

private struct PoweredByInstaBox: View {
    var body: some View {
        Text("Powered by [InstaBox](https://instabox.sh)")
            .font(.footnote)
            .foregroundStyle(Theme.muted)
            .tint(Theme.heading)
    }
}

/// Claiming the computer, then naming the first Bot, on one screen so nothing
/// jumps: the box waits seen from above, and on Claim turns toward the user in
/// place and starts. The start takes at least fourteen seconds even when the
/// computer is ready sooner; meanwhile the user picks a face for their first
/// Bot, which lands on the box's front as a sticker. On Continue the faces stay
/// where they are, the box fades, and the sticker moves up to be the Bot's face
/// above its name. With no session this stays a preview. A live session claims the
/// account's free computer: the first owned workspace, or "My workspace" when it has
/// none, then the OpenCode runtime on the Box that workspace starts.
private struct ClaimFlow: View {
    @State private var overflows = false
    /// A folding phone's cover, or landscape: the page drops its spare room to fit.
    @State private var short = false
    let animate: Bool
    var startClaimed = false
    let done: () -> Void
    let skip: () -> Void
    let onFinish: () -> Void
    var session: AuthSession? = nil

    @AppStorage("onboarding.botFace") private var face = ""
    @State private var shown = false
    @State private var offered = false
    @State private var claimed = false
    @State private var turn = 0.0
    @State private var starting = false
    @State private var checked = 0
    @State private var pulse = false
    @State private var ready = false
    @State private var naming = false
    @State private var created = false
    @State private var name = ""
    @State private var teamId: String?
    @State private var runtime: RuntimeInstance?
    @State private var animationDone = false
    @State private var claimError: String?
    @State private var createError: String?
    @State private var creating = false
    @State private var provisionTask: Task<Void, Never>?
    @State private var slapped = true
    @State private var peel = 0.0
    @State private var leaving = false
    @State private var picking: Task<Void, Never>?
    @FocusState private var typing: Bool

    private static let side: CGFloat = 160
    private var side: CGFloat { short ? 128 : Self.side }
    private static let sticker: CGFloat = 42
    private static let face: CGFloat = 104
    private static let faces = BotAvatars.files.map { $0.replacingOccurrences(of: ".svg", with: "") }
    private static let checks: [LocalizedStringKey] = [
        "Allocating your computer", "Installing OpenCode", "Connecting to Nuphos",
    ]

    /// "09-frida" is Frida; "01-vermeer-girl" is Vermeer Girl.
    private static func defaultName(_ face: String) -> String {
        let small: Set<String> = ["of", "the", "with", "an", "a"]
        return face.split(separator: "-").dropFirst().enumerated().map { index, word in
            index > 0 && small.contains(String(word)) ? String(word) : word.capitalized
        }.joined(separator: " ")
    }

    private var title: LocalizedStringKey {
        if created { return "Say hi to \(name)" }
        if naming { return "Name your first Bot" }
        if ready { return "Your computer is ready" }
        if starting { return "Starting your computer" }
        return claimed ? "It’s yours" : "Start with a free cloud computer"
    }

    private var detail: LocalizedStringKey {
        if created { return "Your first Bot is on your computer, ready to work." }
        if naming { return "You can change its face and name anytime." }
        if ready { return "Next, give your first Bot a name." }
        if starting { return "While it starts, pick a face for your first Bot." }
        return claimed ? "Unboxing your computer…" : "OpenCode is ready on it, so your Bots can start right away. You can also connect your own computer anytime."
    }

    var body: some View {
        // Laid out at the full height, in a scroll view: the keyboard insets a scroll view
        // instead of shrinking it, so nothing here moves when it opens. It scrolls only on a
        // screen too short for the page (a folding phone's cover), never on a phone it fits.
        GeometryReader { proxy in
            ScrollView {
                content
                    .frame(minHeight: proxy.size.height)
                    .onGeometryChange(for: Bool.self) { $0.size.height > proxy.size.height + 1 } action: { overflows = $0 }
            }
            .scrollDisabled(!overflows)
            .onGeometryChange(for: Bool.self) { $0.size.height < 760 } action: { short = $0 }
        }
        .ignoresSafeArea(.keyboard, edges: .bottom)
    }

    private var content: some View {
        TourLayout(title: title, detail: detail, revealed: claimed ? (ready || claimError != nil) : offered, headerHeight: short ? 84 : 110) {
            VStack(spacing: short ? 12 : 18) {
                stage
                // On a phone it always takes its room, so nothing above moves when it arrives or
                // leaves. A short screen has no room to spare, so it makes room as the box turns.
                if !short || claimed || created { ZStack {
                    VStack(spacing: 12) {
                        picker
                        status.opacity(naming ? 0 : 1)
                    }
                    .opacity(starting && !created ? 1 : 0)
                    .allowsHitTesting(starting && !created)
                    if created { greeting.transition(.opacity.combined(with: .move(edge: .bottom))) }
                }
                .transition(.opacity) }
            }
        } actions: {
            // The same two rows throughout, so nothing above them moves.
            VStack(spacing: 4) {
                if let actionError {
                    Text(actionError)
                        .font(.footnote)
                        .foregroundStyle(Theme.attention)
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: .infinity)
                }
                primaryButton(buttonTitle, action: primaryAction)
                    .disabled(creating
                              || (naming && !created && name.trimmingCharacters(in: .whitespaces).isEmpty)
                              || (claimError != nil && !naming && !created))
                Button("I’ll use my own computer", action: leave)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(Theme.muted)
                    .frame(minHeight: 44)
                    .opacity(showSkip ? 1 : 0)
                    .disabled(!showSkip)
            }
        }
        .navigationBarBackButtonHidden(claimed)
        .animation(.easeInOut(duration: 0.3), value: ready)
        .animation(.easeInOut(duration: 0.3), value: starting)
        .animation(.easeInOut(duration: 0.3), value: claimed)
        .animation(.easeInOut(duration: 0.35), value: created)
        .task {
            await play(animate, steps: [
                (0.2, .spring(response: 0.6, dampingFraction: 0.75), { shown = true }),
                (0.5, nil, {}),
            ]) {
                offered = true
                done()
            }
            if startClaimed { claim() }
        }
        .onDisappear { provisionTask?.cancel() }
        .task(id: starting && !ready && claimError == nil) {
            guard starting, !ready, claimError == nil, animate else { return }
            while !Task.isCancelled && !ready && claimError == nil {
                withAnimation(.easeInOut(duration: 0.6)) { pulse.toggle() }
                do { try await Task.sleep(for: .seconds(0.6)) } catch { return }
            }
        }
    }

    private var buttonTitle: LocalizedStringKey {
        if created { return "Start chatting" }
        if naming { return "Create" }
        return claimed ? "Continue" : "Claim my computer"
    }

    /// The skip row stays in the layout. It comes back after the computer fails to appear.
    private var showSkip: Bool { !claimed || claimError != nil }

    /// Shown with the buttons when the status line is not on screen.
    private var actionError: String? {
        if naming, let createError { return createError }
        if !starting, let claimError, !ready { return claimError }
        return nil
    }

    private func primaryAction() {
        if created { onFinish() }
        else if naming { createBot() }
        else if claimed {
            guard claimError == nil else { return }
            withAnimation(.spring(response: 0.55, dampingFraction: 0.82)) { naming = true }
        } else { claim() }
    }

    /// Skip never creates a workspace or a Bot.
    private func leave() {
        provisionTask?.cancel()
        skip()
    }

    /// The box with its label, or, once naming, the Bot's face over its name. The
    /// sticker is one view throughout, so it travels from the box to the face.
    private var stage: some View {
        let geometry = BoxGeometry(side: side, turn: 1)
        let height = geometry.frame.height + 38
        return GeometryReader { proxy in
            let boxLeft = (proxy.size.width - geometry.frame.width) / 2
            let spot = geometry.frontPoint(x: 0.8, y: 0.5, in: geometry.frame)
            ZStack(alignment: .top) {
                VStack(spacing: 10) {
                    OnboardingBox(turn: turn, light: ready ? 1 : (starting ? (pulse ? 1 : 0.15) : 0),
                                  side: side, mark: "InstaBoxMark") { EmptyView() }
                        .accessibilityElement(children: .contain)
                        .accessibilityLabel("Your Nuphos computer")
                    PoweredByInstaBox()
                }
                .opacity(naming ? 0 : (shown ? 1 : 0))
                .scaleEffect(naming ? 0.9 : 1)
                .offset(y: shown ? 0 : -24)
                if naming {
                    nameField
                        .padding(.top, Self.face + 40)
                        .transition(.opacity.combined(with: .scale(scale: 0.92)))
                }
                if let asset = BotAvatars.asset(named: face), turn > 0.99 {
                    // On the way up the sticker quietly becomes the face itself, drawn at its
                    // full size so it stays sharp; the sticker is only for the box.
                    ZStack {
                        PeelSticker(image: asset, size: Self.sticker, peel: peel)
                            .scaleEffect(naming ? Self.face / Self.sticker : 1)
                            .opacity(naming ? 0 : 1)
                        BotFace(face: face, size: Self.face)
                            .scaleEffect(naming ? 1 : Self.sticker / Self.face)
                            .opacity(naming ? 1 : 0)
                            .contentTransition(.opacity)
                    }
                        .rotationEffect(.degrees(naming ? 0 : -6))
                        .scaleEffect(slapped ? 1 : 1.6)
                        .opacity(slapped && !leaving ? 1 : 0)
                        .position(naming
                                  ? CGPoint(x: proxy.size.width / 2, y: Self.face / 2 + 16)
                                  : CGPoint(x: boxLeft + spot.x, y: spot.y))
                        .accessibilityLabel("Your first Bot’s face")
                }
            }
            .frame(width: proxy.size.width, height: height, alignment: .top)
        }
        .frame(height: height)
    }

    private var nameField: some View {
        TextField("Name your Bot", text: $name)
            .font(.title3.weight(.semibold))
            .multilineTextAlignment(.center)
            .textInputAutocapitalization(.words)
            .submitLabel(.done)
            .focused($typing)
            .padding(.horizontal, 16)
            .frame(width: 240, height: 48)
            .background(Theme.surface, in: Capsule())
            .overlay(Capsule().strokeBorder(Theme.muted.opacity(0.2)))
            .disabled(created || creating)
            .accessibilityLabel("Bot name")
    }

    private var greeting: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Hi! I’m \(name). I can read your email, keep your calendar, and take notes in meetings. What should we start with?")
                .font(.subheadline)
                .padding(.horizontal, 14).padding(.vertical, 10)
                .background(Theme.surface, in: RoundedRectangle(cornerRadius: 18))
            HStack(spacing: 8) {
                ForEach(["Sort my inbox", "Plan my week", "Prep a meeting"], id: \.self) { idea in
                    Text(LocalizedStringKey(idea)).font(.footnote.weight(.medium))
                        .padding(.horizontal, 10).frame(height: 32)
                        .background(Theme.surface, in: Capsule())
                        .overlay(Capsule().strokeBorder(Theme.muted.opacity(0.2)))
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var picker: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            // Sized so the last column on screen is cut in half, which shows the row scrolls.
            LazyHGrid(rows: [GridItem(.fixed(56)), GridItem(.fixed(56))], spacing: 12) {
                ForEach(Self.faces, id: \.self) { name in
                    Button { pick(name) } label: {
                        BotFace(face: name, size: 50)
                            .padding(3)
                            .overlay(Circle().strokeBorder(Theme.heading, lineWidth: face == name ? 2 : 0))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Self.defaultName(name))
                    .accessibilityAddTraits(face == name ? .isSelected : [])
                }
            }
            .padding(.horizontal, 24)
        }
        .frame(height: 124)
        .padding(.horizontal, -24)
    }

    private var status: some View {
        HStack(spacing: 8) {
            if let claimError, !ready {
                Text(claimError)
                    .font(.footnote)
                    .multilineTextAlignment(.center)
            } else if ready {
                Image(systemName: "checkmark.circle.fill")
                Text("Ready")
                    .font(.footnote)
                    .contentTransition(.opacity)
            } else {
                ProgressView().controlSize(.small)
                Text(Self.checks[min(checked, Self.checks.count - 1)])
                    .font(.footnote)
                    .contentTransition(.opacity)
            }
        }
        .foregroundStyle(claimError != nil && !ready ? Theme.attention : Theme.muted)
        .accessibilityElement(children: .combine)
    }

    /// The sticker on the box is peeled all the way off and fades where it is; then
    /// the new one lands at once and is smoothed down.
    private func pick(_ newFace: String) {
        guard newFace != face else { return }
        picking?.cancel()
        if naming {
            // A face now, not a sticker: it simply changes.
            withAnimation(.easeInOut(duration: 0.2)) {
                face = newFace
            }
            return
        }
        picking = Task { @MainActor in
            if !face.isEmpty && slapped {
                // All the way off first, then it fades.
                withAnimation(.easeInOut(duration: 0.6)) { peel = 1.67 }
                try? await Task.sleep(for: .milliseconds(600))
                withAnimation(.easeOut(duration: 0.25)) { leaving = true }
                try? await Task.sleep(for: .milliseconds(250))
            }
            guard !Task.isCancelled else { return }
            var still = Transaction()
            still.disablesAnimations = true
            withTransaction(still) {
                leaving = false; slapped = false; peel = 0.35; face = newFace
            }
            withAnimation(.easeIn(duration: 0.12)) { slapped = true }
            try? await Task.sleep(for: .milliseconds(120))
            withAnimation(.easeOut(duration: 0.2)) { peel = 0 }
        }
    }

    private func claim() {
        guard !claimed else { return }
        claimed = true
        face = ""
        name = ""
        claimError = nil
        if let token = session?.token {
            provisionTask = Task { await startComputer(token: token) }
        }
        Task {
            let steps: [(Double, Animation?, () -> Void)] = [
                (0.25, deskTurn, { turn = 1 }),
                (0.9, .easeOut(duration: 0.3), { starting = true }),
                (4.2, .easeInOut(duration: 0.2), { checked = 1 }),
                (4.0, .easeInOut(duration: 0.2), { checked = 2 }),
                (3.8, .easeInOut(duration: 0.2), { checked = 3 }),
                (0.4, .easeOut(duration: 0.3), {
                    if session?.token == nil {
                        ready = true
                        if face.isEmpty, let any = Self.faces.randomElement() { pick(any) }
                    } else {
                        animationDone = true
                        revealIfReady()
                    }
                }),
            ]
            await play(animate, steps: steps) {}
            #if DEBUG
            // `-cloudTourNaming YES` walks on to naming, for screenshots of the offline tour.
            if session?.token == nil, UserDefaults.standard.bool(forKey: "cloudTourNaming") {
                try? await Task.sleep(for: .seconds(1.2))
                primaryAction()
                if UserDefaults.standard.bool(forKey: "cloudTourType") {
                    try? await Task.sleep(for: .seconds(1))
                    typing = true
                }
                if UserDefaults.standard.bool(forKey: "cloudTourCreate") {
                    try? await Task.sleep(for: .seconds(1.2))
                    primaryAction()
                }
            }
            #endif
        }
    }

    /// The animation still takes about fourteen seconds. Ready waits for both that and the computer.
    private func revealIfReady() {
        guard animationDone, runtime != nil, claimError == nil, !ready else { return }
        withAnimation(.easeOut(duration: 0.3)) {
            ready = true
            if face.isEmpty, let any = Self.faces.randomElement() { pick(any) }
        }
    }

    /// One workspace: the first one this account owns, or "My workspace" when it has none.
    /// Creating that team is what starts the free computer. This never posts a Box itself.
    private func startComputer(token: String) async {
        do {
            let team = try await resolveTeam(token: token)
            guard !Task.isCancelled else { return }
            teamId = team.id
            runtime = try await waitForOpenCode(token: token, teamId: team.id)
            guard !Task.isCancelled else { return }
            revealIfReady()
        } catch is CancellationError {
            return
        } catch let url as URLError where url.code == .cancelled {
            return
        } catch {
            guard !Task.isCancelled else { return }
            claimError = error.localizedDescription
        }
    }

    private func resolveTeam(token: String) async throws -> Team {
        let teams = try await NuphosAPI.teams(token: token)
        if let owned = teams.first(where: { $0.isOwner == true }) { return owned }
        let created: WorkspaceAPI.TeamEnvelope = try await WorkspaceAPI.request(
            "teams", token: token, method: "POST",
            body: .object(["name": .string("My workspace")])
        )
        return created.team
    }

    /// Polls until OpenCode on this workspace's Box can be selected. About three minutes
    /// with no Box, or a Box that reports error, surfaces the failure and brings skip back.
    /// A Box that is still starting keeps the screen on Starting past that, until OpenCode is ready.
    private func waitForOpenCode(token: String, teamId: String) async throws -> RuntimeInstance {
        let started = Date()
        while !Task.isCancelled {
            do {
                let listed: ClaimDevices = try await WorkspaceAPI.request(
                    "agent/devices", query: [URLQueryItem(name: "teamId", value: teamId)], token: token
                )
                let boxes = listed.devices.filter { $0.box != nil }
                let runtimes = boxes.isEmpty ? [] : try await NuphosAPI.runtimeInstances(token: token, teamId: teamId)
                let openCode = { (box: AgentDevice) -> RuntimeInstance? in
                    guard box.box?.state != "error" else { return nil }
                    return runtimes.first {
                        $0.provider == .opencode && $0.isSelectable && $0.local?.deviceId == box.deviceId
                    }
                }
                // The free computer is "Computer 1". Wait on that one, so another computer's
                // runtime is not taken while it is still starting.
                if let computer = boxes.first(where: { $0.label == "Computer 1" }) {
                    if computer.box?.state == "error" { throw ClaimFailure.noComputer }
                    if let match = openCode(computer) { return match }
                } else if let match = boxes.compactMap({ openCode($0) }).first {
                    return match
                } else if boxes.isEmpty && Date().timeIntervalSince(started) >= 180 {
                    throw ClaimFailure.noComputer
                } else if !boxes.isEmpty && boxes.allSatisfy({ $0.box?.state == "error" }) {
                    throw ClaimFailure.noComputer
                }
            } catch is CancellationError {
                throw CancellationError()
            } catch let url as URLError where url.code == .cancelled {
                throw CancellationError()
            } catch is ClaimFailure {
                throw ClaimFailure.noComputer
            } catch {
                if Date().timeIntervalSince(started) >= 180 { throw error }
            }
            try await Task.sleep(for: .seconds(3))
        }
        throw CancellationError()
    }

    /// One create. A failure stays on the name and says why; a second tap can try again.
    private func createBot() {
        typing = false
        guard let token = session?.token else { created = true; return }
        guard !creating, !created, let teamId, let runtime else { return }
        let title = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty else { return }
        if face.isEmpty, let any = Self.faces.randomElement() { face = any }
        creating = true
        createError = nil
        let avatar = face
        Task {
            defer { creating = false }
            do {
                _ = try await AgentChatAPI.createBot(
                    token: token, teamId: teamId, title: title, avatar: avatar, runtime: runtime
                )
                guard !Task.isCancelled else { return }
                created = true
            } catch is CancellationError {
                return
            } catch {
                guard !Task.isCancelled else { return }
                createError = error.localizedDescription
            }
        }
    }
}

/// `GET agent/devices?teamId=` as this screen reads it: the Box, when the row is one.
private struct ClaimDevices: Decodable { let devices: [AgentDevice] }

private enum ClaimFailure: LocalizedError {
    case noComputer

    var errorDescription: String? {
        String(localized: "Your free computer didn’t start. You can use your own computer instead.")
    }
}
#endif

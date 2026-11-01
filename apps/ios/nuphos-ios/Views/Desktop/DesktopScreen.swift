import SwiftUI

/// A conversation's desktop, full screen or in a pane beside it. Taller than
/// wide, the picture sits on top with the controls, a row of keys and a
/// trackpad below it, as in Sill; wider, the picture fills it and takes touch directly.
struct DesktopScreen: View {
    @State private var desktop: DesktopSession
    /// Closes the screen. Its presenter passes this rather than the screen
    /// relying on `dismiss`, which does nothing where the screen is a root.
    let close: () -> Void

    @Environment(\.scenePhase) private var scenePhase
    @State private var keyboard = false
    /// The screen's space without the keyboard, which decides the layout.
    @State private var size = CGSize(width: 1, height: 2)
    /// The iPhone Duo's fold across the screen while half open: the picture stays above it.
    @State private var fold: CGRect?

    init(desktop: DesktopSession, close: @escaping () -> Void) {
        _desktop = State(initialValue: desktop)
        self.close = close
    }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            if size.height > size.width {
                // The keyboard covers the trackpad rather than squeezing the picture.
                uprightLayout(width: size.width).ignoresSafeArea(.keyboard)
            } else {
                sidewaysLayout
            }
            DesktopKeyInput(desktop: desktop, shown: $keyboard)
                .frame(width: 1, height: 1)
                .opacity(0.01)
                .allowsHitTesting(false)
            status
        }
        .background {
            GeometryReader { geometry in
                Color.clear
                    .onAppear { size = geometry.size }
                    .onChange(of: geometry.size) { _, new in size = new }
            }
            .ignoresSafeArea(.keyboard)
        }
        .readsFold($fold)
        // Dark here only: in a pane, the conversation beside it keeps its own.
        .environment(\.colorScheme, .dark)
        // Whoever presents it starts and stops the stream (DesktopPresentation), so moving
        // between the pane and full screen keeps the connection and control.
        .onChange(of: scenePhase) { _, phase in
            // Leaving the app closes the stream, which hands the desktop back.
            if phase == .active { desktop.start() } else if phase == .background { desktop.stop() }
        }
        .onChange(of: desktop.controlling) { _, controlling in if !controlling { keyboard = false } }
    }

    // MARK: - Layouts

    private func uprightLayout(width: CGFloat) -> some View {
        // As in Sill: the picture in a 16:10 pane on top, the controls below. Half open, the
        // picture takes everything above the fold and the controls start below it.
        let band = fold.flatMap { $0.width >= $0.height ? $0 : nil }
        return VStack(spacing: 8) {
            canvas
                .frame(height: band.map { max($0.minY - 8, 120) } ?? ((width - 16) / 1.6).rounded())
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                .padding(.horizontal, 8)
            if let band { Color.clear.frame(height: band.height) }
            controls
                .padding(.horizontal, 8)
            keyRow
                .padding(.horizontal, 8)
            ZStack {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(Color.white.opacity(0.06))
                if desktop.controlling {
                    Text("Drag to move the pointer. Tap to click, two fingers to scroll.")
                        .font(Theme.Text.caption)
                        .foregroundStyle(.white.opacity(0.35))
                        .multilineTextAlignment(.center)
                        .padding(24)
                        .allowsHitTesting(false)
                    DesktopTrackpad(desktop: desktop)
                } else {
                    takeOverPrompt
                }
            }
            .frame(maxHeight: .infinity)
            .padding(.horizontal, 8)
            .padding(.bottom, 8)
        }
    }

    private var sidewaysLayout: some View {
        // In the safe area, so a pane's buttons stay clear of the bar above it; a 16:10 picture
        // fits a phone held sideways within it anyway.
        ZStack(alignment: .top) {
            canvas
            HStack(spacing: 8) {
                closeButton
                Spacer()
                if desktop.canFitWindow && desktop.controlling { windowButton }
                if desktop.controlling { keyboardButton }
                controlButton
            }
            .padding(.horizontal, 12)
            .padding(.top, 8)
        }
        .safeAreaInset(edge: .bottom) {
            if keyboard { keyRow.padding(8).background(.ultraThinMaterial) }
        }
    }

    // MARK: - Pieces

    /// The picture; its size is what a Mac fits the window it shows to.
    private var canvas: some View {
        DesktopCanvas(desktop: desktop)
            .onGeometryChange(for: CGSize.self) { $0.size } action: { desktop.fit($0) }
    }

    /// One window fitted to the picture, or the whole Desktop, as Sill's Desktop button switches;
    /// with control only, as the relay passes the request then.
    private var windowButton: some View {
        Button { desktop.showsWindow.toggle() } label: {
            Image(systemName: desktop.showsWindow ? "macwindow" : "menubar.dock.rectangle")
                .font(.system(size: 16, weight: .medium))
                .frame(width: 44, height: 36)
                .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color.white.opacity(0.12)))
        }
        .foregroundStyle(.white)
        .accessibilityLabel(desktop.showsWindow ? "Show the whole Desktop" : "Fit the front window")
    }

    /// Only what controls the computer, as in Sill's bar: close, keyboard and Take over.
    private var controls: some View {
        HStack(spacing: 8) {
            closeButton
            keyboardButton.disabled(!desktop.controlling)
            if desktop.canFitWindow { windowButton.disabled(!desktop.controlling) }
            Spacer()
            controlButton
        }
    }

    private var closeButton: some View {
        Button(action: close) {
            Image(systemName: "xmark")
                .font(.system(size: 15, weight: .semibold))
                .frame(width: 36, height: 36)
                .background(Circle().fill(Color.white.opacity(0.12)))
        }
        .foregroundStyle(.white)
        .accessibilityLabel("Close desktop")
    }

    private var keyboardButton: some View {
        Button { keyboard.toggle() } label: {
            Image(systemName: keyboard ? "keyboard.chevron.compact.down" : "keyboard")
                .font(.system(size: 16, weight: .medium))
                .frame(width: 44, height: 36)
                .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color.white.opacity(keyboard ? 0.24 : 0.12)))
        }
        .foregroundStyle(.white)
        .accessibilityLabel(keyboard ? "Hide keyboard" : "Show keyboard")
    }

    private var controlButton: some View {
        Button { desktop.setControlling(!desktop.controlling) } label: {
            Label(desktop.controlling ? "Hand back" : "Take over", systemImage: desktop.controlling ? "hand.raised.slash" : "hand.point.up.left")
                .font(Theme.Text.label.weight(.semibold))
                .padding(.horizontal, 14)
                .frame(height: 36)
                .background(Capsule().fill(desktop.controlling ? Color.white.opacity(0.12) : Theme.brand))
        }
        .foregroundStyle(.white)
        .disabled(desktop.phase != .live)
    }

    private var takeOverPrompt: some View {
        VStack(spacing: 10) {
            Image(systemName: "hand.point.up.left")
                .font(.system(size: 28, weight: .light))
            Text(desktop.isMacScreen
                 ? "Take over to click, type and scroll on the Mac from here."
                 : "Take over to click, type and scroll here. The agent waits until you hand the desktop back.")
                .font(Theme.Text.caption)
                .multilineTextAlignment(.center)
        }
        .foregroundStyle(.white.opacity(0.45))
        .padding(28)
    }

    /// esc, tab and the modifiers, which latch for the next key or click, then the arrows.
    private var keyRow: some View {
        HStack(spacing: 6) {
            DesktopKeyCap("esc") { desktop.key(RFBKeysym.escape) }
            DesktopKeyCap("tab") { desktop.key(RFBKeysym.tab) }
            DesktopKeyCap("⌃", latched: desktop.latched.contains(RFBKeysym.control)) { desktop.toggleLatch(RFBKeysym.control) }
            DesktopKeyCap("⌥", latched: desktop.latched.contains(RFBKeysym.option)) { desktop.toggleLatch(RFBKeysym.option) }
            DesktopKeyCap("⌘", latched: desktop.latched.contains(RFBKeysym.command)) { desktop.toggleLatch(RFBKeysym.command) }
            DesktopKeyCap("⇧", latched: desktop.latched.contains(RFBKeysym.shift)) { desktop.toggleLatch(RFBKeysym.shift) }
            DesktopKeyCap("←") { desktop.key(RFBKeysym.left) }
            DesktopKeyCap("↑") { desktop.key(RFBKeysym.up) }
            DesktopKeyCap("↓") { desktop.key(RFBKeysym.down) }
            DesktopKeyCap("→") { desktop.key(RFBKeysym.right) }
        }
        .disabled(!desktop.controlling)
        .opacity(desktop.controlling ? 1 : 0.4)
    }

    @ViewBuilder
    private var status: some View {
        switch desktop.phase {
        case .connecting where desktop.screenSize == .zero:
            ProgressView("Connecting…")
                .tint(.white)
                .foregroundStyle(.white.opacity(0.7))
        case .failed(let message):
            VStack(spacing: 14) {
                Image(systemName: "display.trianglebadge.exclamationmark")
                    .font(.system(size: 34, weight: .light))
                Text(message)
                    .font(Theme.Text.secondary)
                    .multilineTextAlignment(.center)
                HStack(spacing: 12) {
                    Button("Close", action: close)
                        .buttonStyle(.bordered)
                    Button("Try again") { desktop.retry() }
                        .buttonStyle(.borderedProminent)
                        .tint(Theme.brand)
                }
            }
            .foregroundStyle(.white)
            .padding(28)
            .frame(maxWidth: 360)
            .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Color(white: 0.12)))
            .padding(24)
        default:
            EmptyView()
        }
    }
}

private struct DesktopKeyCap: View {
    let label: String
    var latched = false
    let action: () -> Void

    init(_ label: String, latched: Bool = false, action: @escaping () -> Void) {
        self.label = label
        self.latched = latched
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            Text(verbatim: label)
                .font(.system(size: label.count > 1 ? 13 : 17, weight: .medium))
                .frame(maxWidth: .infinity)
                .frame(height: 40)
                .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(latched ? Theme.brand : Color.white.opacity(0.12)))
        }
        .foregroundStyle(.white)
        .buttonStyle(.plain)
    }
}

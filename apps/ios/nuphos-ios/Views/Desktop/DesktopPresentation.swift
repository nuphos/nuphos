import SwiftUI

extension EnvironmentValues {
    /// Set where the window is wide enough to show a desktop beside what opened it: called with
    /// true as one opens there and false as it closes. Nil where the desktop takes the screen.
    @Entry var desktopBeside: ((Bool) -> Void)?
}

extension View {
    /// Shows `desktop` while it is set: beside this view, on its right, where the window is wide
    /// (the iPhone Duo open, an iPad), else full screen. Closing it sets it to nil.
    func desktop(_ desktop: Binding<DesktopSession?>) -> some View {
        modifier(DesktopPresentation(desktop: desktop))
    }
}

private struct DesktopPresentation: ViewModifier {
    @Binding var desktop: DesktopSession?
    @Environment(\.desktopBeside) private var beside
    /// The iPhone Duo's fold while half open. Down the middle (the book pose), the conversation
    /// and the desktop go on either side of it; across (the laptop pose), the desktop takes the
    /// screen, as in Sill: the picture above the fold, the controls below.
    @State private var fold: CGRect?
    /// The desktop whose stream runs: one for as long as it is open, wherever it is shown.
    @State private var running: DesktopSession?

    /// Beside what opened it: a wide window, unless the fold runs across it (the laptop pose).
    private var besides: Bool { beside != nil && fold.map { $0.height > $0.width } != false }

    func body(content: Content) -> some View {
        let band = fold.flatMap { $0.height > $0.width ? $0 : nil }
        HStack(spacing: 0) {
            content
                .frame(width: desktop == nil || !besides ? nil : band?.minX)
            if besides, let desktop {
                if let band { Color.clear.frame(width: band.width) }
                DesktopScreen(desktop: desktop) { self.desktop = nil }
                    .id(ObjectIdentifier(desktop))
                    .containerRelativeFrame(.horizontal) { width, _ in band.map { width - $0.maxX } ?? (width * 0.6).rounded() }
            }
        }
        .readsFold($fold)
        .onChange(of: desktop.map(ObjectIdentifier.init), initial: true) {
            beside?(desktop != nil)
            if running !== desktop {
                running?.stop()
                running = desktop
                running?.start()
            }
        }
        .onDisappear {
            // Covering it full screen makes this disappear too; the desktop is still open then.
            guard besides || desktop == nil else { return }
            running?.stop()
            running = nil
            if desktop != nil { beside?(false) }
        }
        // Only X closes it (it sets `desktop` to nil); a fold or a wider window moves it beside instead.
        .fullScreenCover(isPresented: Binding(get: { !besides && desktop != nil }, set: { _ in })) {
            if let desktop {
                DesktopScreen(desktop: desktop) { self.desktop = nil }
                    .statusBarHidden()
                    .persistentSystemOverlays(.hidden)
            }
        }
    }
}

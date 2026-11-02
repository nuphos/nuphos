import SwiftUI

extension View {
    /// Shows `panel` on the right while `isOpen`: beside this view where the window is wide
    /// (an iPad), else over it, sliding in from the right edge. A swipe in from the right edge
    /// opens it; the left edge stays the system's back swipe.
    func dock<Panel: View>(isOpen: Binding<Bool>, @ViewBuilder panel: @escaping () -> Panel) -> some View {
        modifier(DockPresentation(isOpen: isOpen, panel: panel))
    }
}

private struct DockPresentation<Panel: View>: ViewModifier {
    @Binding var isOpen: Bool
    let panel: () -> Panel
    @Environment(\.horizontalSizeClass) private var sizeClass
    /// How far a drag to the right has pulled the open panel back.
    @State private var pull: CGFloat = 0

    func body(content: Content) -> some View {
        Group {
            if sizeClass == .regular {
                HStack(spacing: 0) {
                    content
                    if isOpen {
                        Divider()
                        panel().frame(width: 340).transition(.move(edge: .trailing))
                    }
                }
            } else {
                content.overlay { if isOpen { slideOver } }
            }
        }
        .gesture(RightEdgeSwipe { withAnimation(.snappy) { isOpen = true } })
        .animation(.snappy, value: isOpen)
    }

    private var slideOver: some View {
        GeometryReader { proxy in
            let width = min(proxy.size.width * 0.86, 380)
            ZStack(alignment: .trailing) {
                Color.black.opacity(0.25 * (1 - pull / width))
                    .ignoresSafeArea()
                    .onTapGesture { isOpen = false }
                    .accessibilityHidden(true)
                panel()
                    .frame(width: width)
                    .clipShape(UnevenRoundedRectangle(topLeadingRadius: 16, bottomLeadingRadius: 16))
                    .shadow(color: .black.opacity(0.15), radius: 12)
                    .offset(x: pull)
                    .gesture(
                        DragGesture(minimumDistance: 12)
                            .onChanged { pull = max(0, $0.translation.width) }
                            .onEnded { drag in
                                let closes = drag.translation.width > width / 3 || drag.predictedEndTranslation.width > width / 2
                                withAnimation(.snappy) {
                                    pull = 0
                                    if closes { isOpen = false }
                                }
                            }
                    )
            }
        }
        .transition(.move(edge: .trailing).combined(with: .opacity))
    }
}

/// UIKit's own screen-edge pan from the right: it only begins at that edge, so taps and the
/// transcript's scrolling are left alone.
private struct RightEdgeSwipe: UIGestureRecognizerRepresentable {
    var onSwipe: () -> Void

    func makeUIGestureRecognizer(context: Context) -> UIScreenEdgePanGestureRecognizer {
        let pan = UIScreenEdgePanGestureRecognizer()
        pan.edges = .right
        return pan
    }

    func handleUIGestureRecognizerAction(_ recognizer: UIScreenEdgePanGestureRecognizer, context: Context) {
        guard recognizer.state == .ended else { return }
        let view = recognizer.view
        if recognizer.translation(in: view).x < -40 || recognizer.velocity(in: view).x < -300 { onSwipe() }
    }
}

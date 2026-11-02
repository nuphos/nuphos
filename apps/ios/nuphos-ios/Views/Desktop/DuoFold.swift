import SwiftUI

extension View {
    /// The iPhone Duo's fold across this view while it is half open, in this view's space, as
    /// Sill reads it (iOS 27.1's reserved division region): nil open flat, on the cover display,
    /// on every other device and before iOS 27.1. Nothing a finger uses goes on it.
    func readsFold(_ fold: Binding<CGRect?>) -> some View { modifier(FoldReader(fold: fold)) }
}

private struct FoldReader: ViewModifier {
    @Binding var fold: CGRect?
    /// Bumped as the hinge moves, which is when the region comes and goes.
    @State private var hinge = 0

    func body(content: Content) -> some View {
        content
            .background {
                GeometryReader { geometry in
                    Color.clear
                        .onAppear { fold = geometry.activeFold }
                        .onChange(of: geometry.frame(in: .global)) { fold = geometry.activeFold }
                        .onChange(of: hinge) { fold = geometry.activeFold }
                }
            }
            .modifier(HingeWatch(tick: $hinge))
    }
}

private struct HingeWatch: ViewModifier {
    @Binding var tick: Int

    func body(content: Content) -> some View {
        if #available(iOS 27.1, *) {
            content.onHingeChange { _, _ in tick += 1 }
        } else {
            content
        }
    }
}

private extension GeometryProxy {
    var activeFold: CGRect? {
        #if DEBUG
        // `-desktop-fold x,y,w,h`: a fold in window points, for the simulator, which has no hinge to bend.
        let args = CommandLine.arguments
        if let i = args.firstIndex(of: "-desktop-fold"), i + 1 < args.count {
            let n = args[i + 1].split(separator: ",").compactMap { Double($0) }
            guard n.count == 4 else { return nil }
            let frame = frame(in: .global)
            let band = CGRect(x: n[0], y: n[1], width: n[2], height: n[3]).offsetBy(dx: -frame.minX, dy: -frame.minY)
            return band.intersects(CGRect(origin: .zero, size: size)) ? band : nil
        }
        #endif
        if #available(iOS 27.1, *) {
            return reservedRegions(kind: .division, options: .includeInactive).first(where: \.isActive)?.frame
        }
        return nil
    }
}

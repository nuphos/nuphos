import SwiftUI

/// Tree lines for an Agent page row, as the desktop sidebar draws them: a
/// line drops from a parent's avatar, each thread turns into its own avatar,
/// and a branch stops at its last thread.
struct ThreadTree: View {
    /// A nested row's indent per level.
    static let indent: CGFloat = 32
    /// Per ancestor level, whether that branch continues below this row.
    let trail: [Bool]
    /// This row's own threads are showing, so a line drops from its avatar.
    let expanded: Bool
    /// `ListRow`'s avatar, vertically centred in the row after the state gutter.
    private let avatar = ListRowMetrics.avatar
    private let gutter = ListRowMetrics.gutter
    private let corner: CGFloat = 6

    var body: some View {
        Canvas { context, size in
            let mid = size.height / 2
            let x = { (level: Int) in gutter + CGFloat(level) * Self.indent + avatar / 2 }
            var path = Path()
            for (level, continues) in trail.enumerated() {
                if continues {
                    path.move(to: CGPoint(x: x(level), y: 0))
                    path.addLine(to: CGPoint(x: x(level), y: size.height))
                }
                if level == trail.count - 1 {
                    path.move(to: CGPoint(x: x(level), y: 0))
                    path.addLine(to: CGPoint(x: x(level), y: mid - corner))
                    path.addQuadCurve(to: CGPoint(x: x(level) + corner, y: mid), control: CGPoint(x: x(level), y: mid))
                    path.addLine(to: CGPoint(x: gutter + CGFloat(trail.count) * Self.indent - 3, y: mid))
                }
            }
            if expanded {
                path.move(to: CGPoint(x: x(trail.count), y: mid + avatar / 2 + 3))
                path.addLine(to: CGPoint(x: x(trail.count), y: size.height))
            }
            context.stroke(path, with: .color(Theme.muted.opacity(0.4)), lineWidth: 1)
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

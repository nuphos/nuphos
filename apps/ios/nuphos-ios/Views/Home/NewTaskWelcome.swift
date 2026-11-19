import SwiftUI

/// Desktop's pearl star and greeting, rendered with native SwiftUI layers.
struct NewTaskWelcome: View {
    let name: String
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var appeared = false
    @State private var sheen = false

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            ZStack {
                AngularGradient(colors: [.pink, .purple, .cyan, .pink, .yellow, .pink], center: .center)
                    .rotationEffect(.degrees(sheen && !reduceMotion ? 360 : 0))
                    .mask(AgentStar())
                AgentStar()
                    .fill(RadialGradient(colors: [.white.opacity(0.95), Color(red: 0.96, green: 0.95, blue: 1).opacity(0.85), Color(red: 0.93, green: 0.91, blue: 1).opacity(0.75)], center: .init(x: 0.42, y: 0.38), startRadius: 0, endRadius: 25))
                    .scaleEffect(0.72)
                    .blur(radius: 1)
                Ellipse().fill(.white.opacity(0.9)).frame(width: 9, height: 3)
                    .rotationEffect(.degrees(-45)).offset(x: -4, y: -5).blur(radius: 0.5)
            }
            .frame(width: 36, height: 36)
            .shadow(color: .purple.opacity(0.28), radius: 3, y: 1)
            .rotationEffect(.degrees(appeared || reduceMotion ? 0 : -180))
            .offset(x: appeared || reduceMotion ? 0 : -18)
            .opacity(appeared ? 1 : 0)
            .accessibilityHidden(true)

            Group {
                if let firstName = name.split(whereSeparator: { $0.isWhitespace }).first {
                    Text("What's up next, \(String(firstName))?")
                } else {
                    Text("What's up next?")
                }
            }
            .font(.title2.weight(.semibold))
            .foregroundStyle(Theme.heading)
            .opacity(appeared ? 1 : 0)
            .offset(y: appeared || reduceMotion ? 0 : 8)
            .animation(reduceMotion ? .easeOut(duration: 0.18) : .easeOut(duration: 0.28).delay(0.16), value: appeared)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 24)
        .padding(.vertical, 32)
        .readableWidth()
        .onAppear {
            withAnimation(reduceMotion ? .easeOut(duration: 0.18) : .spring(duration: 0.34)) { appeared = true }
            if !reduceMotion {
                withAnimation(.easeOut(duration: 0.34)) { sheen = true }
            }
        }
        .onChange(of: reduceMotion) { _, reduced in
            if reduced { sheen = false }
            else { withAnimation(.easeOut(duration: 0.34)) { sheen = true } }
        }
    }
}

private struct AgentStar: Shape {
    func path(in rect: CGRect) -> Path {
        let x = rect.width / 24
        let y = rect.height / 24
        var path = Path()
        path.move(to: CGPoint(x: 12 * x, y: 0))
        path.addCurve(to: CGPoint(x: 24 * x, y: 12 * y), control1: CGPoint(x: 12 * x, y: 6.6 * y), control2: CGPoint(x: 17.4 * x, y: 12 * y))
        path.addCurve(to: CGPoint(x: 12 * x, y: 24 * y), control1: CGPoint(x: 17.4 * x, y: 12 * y), control2: CGPoint(x: 12 * x, y: 17.4 * y))
        path.addCurve(to: CGPoint(x: 0, y: 12 * y), control1: CGPoint(x: 12 * x, y: 17.4 * y), control2: CGPoint(x: 6.6 * x, y: 12 * y))
        path.addCurve(to: CGPoint(x: 12 * x, y: 0), control1: CGPoint(x: 6.6 * x, y: 12 * y), control2: CGPoint(x: 12 * x, y: 6.6 * y))
        path.closeSubpath()
        return path.offsetBy(dx: rect.minX, dy: rect.minY)
    }
}

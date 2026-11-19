import SwiftUI

/// A question as its card's title: one line, cut with an ellipsis, as on Desktop. A tap shows it
/// in full, so a long question asked before the one-line limit loses nothing.
struct QuestionTitle: View {
    let text: String
    let size: CGFloat
    var tracking: CGFloat = 0
    let identifier: String
    @State private var open = false

    var body: some View {
        Text(text)
            .font(.system(size: size, weight: .semibold))
            .tracking(tracking)
            .lineSpacing(open ? 3 : 0)
            .foregroundStyle(Theme.heading)
            .lineLimit(open ? nil : 1)
            .truncationMode(.tail)
            .fixedSize(horizontal: false, vertical: open)
            .contentShape(Rectangle())
            .onTapGesture { open.toggle() }
            .accessibilityAddTraits(.isHeader)
            .accessibilityIdentifier(identifier)
    }
}

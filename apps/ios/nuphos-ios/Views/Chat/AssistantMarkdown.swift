import MarkdownParser
// `TextLabelView` / `TextLabel.Layout` come from Litext, which MarkdownView
// re-exports — no separate product to link.
import MarkdownView
import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

/// Assistant text, rendered as Markdown with no bubble. Wraps the package's
/// `MarkdownTextView` directly (its SwiftUI `MarkdownView` wires no link
/// handler) so taps on links reach `onLink`; streaming deltas are throttled
/// the same way the package does it.
struct AssistantMarkdown: View {
    let text: String
    /// While the answer is still being written, its last marker is usually
    /// only half there.
    var streaming = false
    /// A tapped link. Absent, links do nothing.
    var onLink: ((URL) -> Void)?

    @Environment(\.dynamicTypeSize) private var typeSize

    private var rendered: String {
        streaming ? StreamingMarkdown.closingOpenMarkers(in: text) : text
    }

    var body: some View {
        MarkdownTextRepresentable(text: rendered, theme: Self.theme, typeSize: typeSize, onLink: onLink)
            .frame(maxWidth: .infinity, alignment: .topLeading)
    }

    static var theme: MarkdownTheme {
        var theme = MarkdownTheme.default
        #if canImport(UIKit)
        theme.colors.body = .label
        theme.colors.code = .label
        theme.fonts.body = Theme.Text.uiFont(.body)
        theme.fonts.bold = Theme.Text.uiFont(.body, weight: .semibold)
        theme.fonts.italic = Theme.Text.italicUIFont(.body)
        theme.fonts.codeInline = Theme.Text.monoUIFont(.subheadline)
        theme.fonts.code = Theme.Text.monoUIFont(.footnote)
        theme.fonts.largeTitle = Theme.Text.uiFont(.title3, weight: .bold)
        theme.fonts.title = Theme.Text.uiFont(.body, weight: .semibold)
        theme.fonts.footnote = Theme.Text.uiFont(.footnote)
        #endif
        theme.spacings.paragraph = 22
        theme.spacings.headingBefore = 24
        theme.spacings.list = 12
        return theme
    }
}

#if canImport(UIKit)
private struct MarkdownTextRepresentable: UIViewRepresentable {
    let text: String
    let theme: MarkdownTheme
    /// The theme's fonts are resolved from this; it is stored so that a new
    /// text size reaches `updateUIView`.
    let typeSize: DynamicTypeSize
    let onLink: ((URL) -> Void)?

    func makeUIView(context: Context) -> MarkdownTextView {
        let view = MarkdownTextView()
        view.theme = theme
        view.setContentHuggingPriority(.required, for: .vertical)
        view.setContentCompressionResistancePriority(.required, for: .vertical)
        view.setContentHuggingPriority(.defaultLow, for: .horizontal)
        view.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        view.linkHandler = { [weak coordinator = context.coordinator] payload, _, _ in
            let url: URL? = switch payload {
            case .url(let u): u
            case .string(let s): URL(string: s)
            }
            if let url { coordinator?.onLink?(url) }
        }

        // Litext selects on a *pointer* drag and on double/triple tap; a finger
        // long press — how every other iOS transcript starts a selection — does
        // nothing. This adds that entry point: the press selects the word under
        // the finger, and Litext takes it from there. `cancelsTouchesInView` is
        // off on purpose, so the label still gets its `touchesEnded` and shows
        // its own edit menu over the new selection when the finger lifts.
        let longPress = UILongPressGestureRecognizer(
            target: context.coordinator,
            action: #selector(Coordinator.selectWord(_:))
        )
        longPress.cancelsTouchesInView = false
        view.addGestureRecognizer(longPress)
        return view
    }

    func updateUIView(_ view: MarkdownTextView, context: Context) {
        context.coordinator.onLink = onLink
        context.coordinator.setTextThrottled(text, theme: theme, on: view)
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: MarkdownTextView, context: Context) -> CGSize? {
        context.coordinator.sizeThatFits(proposal, for: uiView)
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    /// The package's `MarkdownViewCoordinator`, minus the parts we don't use:
    /// applies text at most 20×/s and answers SwiftUI's width probes with
    /// the last concrete width so a resize never lays out for a stale one.
    /// Also owns the long-press that starts a selection.
    @MainActor
    final class Coordinator: NSObject {
        static let throttleInterval: TimeInterval = 1 / 20

        var onLink: ((URL) -> Void)?

        private var lastText = ""
        private var lastTheme: MarkdownTheme = .default
        private var applied = false
        /// The view `applied` refers to.
        private weak var appliedView: MarkdownTextView?
        private var width: CGFloat = 0
        private var pending: (text: String, theme: MarkdownTheme)?
        private var lastApplyDate: Date = .distantPast
        private var scheduled: Task<Void, Never>?

        func setTextThrottled(_ text: String, theme: MarkdownTheme, on view: MarkdownTextView) {
            // A row that leaves the lazy stack and comes back is handed a new,
            // empty view while this coordinator survives. What was applied to
            // the previous one says nothing about this one, so anything
            // remembered about it is dropped rather than skipping the apply —
            // that is what used to leave a one-line blank where the answer is.
            if appliedView !== view {
                scheduled?.cancel()
                scheduled = nil
                pending = nil
                applied = false
            }
            // A newly hosted/reused cell must have its real content before
            // its first size measurement, regardless of streaming throttling.
            if !applied {
                apply(text: text, theme: theme, to: view)
                return
            }
            let target = pending ?? (lastText, lastTheme)
            guard !applied || target.text != text || target.theme != theme else { return }
            let now = Date()
            if scheduled == nil, now.timeIntervalSince(lastApplyDate) >= Self.throttleInterval {
                apply(text: text, theme: theme, to: view)
                return
            }
            pending = (text, theme)
            guard scheduled == nil else { return }
            let delay = max(0, lastApplyDate.addingTimeInterval(Self.throttleInterval).timeIntervalSince(now))
            scheduled = Task { @MainActor [weak self, weak view] in
                try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
                guard let self, !Task.isCancelled else { return }
                scheduled = nil
                guard let view, let pending else { return }
                apply(text: pending.text, theme: pending.theme, to: view)
            }
        }

        func sizeThatFits(_ proposal: ProposedViewSize, for view: MarkdownTextView) -> CGSize? {
            if proposal.width == 0 { return .zero }
            let fittingWidth: CGFloat
            if let proposed = proposal.width, proposed.isFinite, proposed > 0 {
                fittingWidth = proposed
                width = proposed
            } else if width > 0 {
                fittingWidth = width
            } else if view.bounds.width > 0 {
                fittingWidth = view.bounds.width
            } else {
                return nil
            }
            return CGSize(width: fittingWidth, height: ceil(view.boundingSize(for: fittingWidth).height))
        }

        private func apply(text: String, theme: MarkdownTheme, to view: MarkdownTextView) {
            scheduled?.cancel()
            scheduled = nil
            pending = nil
            // Re-applying to the same view is, in practice, an answer
            // streaming in (or a text-size change). Cross-dissolving the redraw leaves unchanged text
            // where it was and fades in what was just appended, the way
            // Desktop's `atlas-stream-in` does.
            if applied {
                let fade = CATransition()
                fade.type = .fade
                fade.duration = 0.24
                fade.timingFunction = CAMediaTimingFunction(controlPoints: 0.16, 1, 0.3, 1)
                view.layer.add(fade, forKey: "streamFadeIn")
            }
            view.setContentImmediately(MarkdownContent(markdown: text, theme: theme), theme: theme)
            view.invalidateIntrinsicContentSize()
            lastText = text
            lastTheme = theme
            applied = true
            appliedView = view
            lastApplyDate = Date()
        }

        // MARK: - Long press to select

        /// The layout used to turn a touch into a string index. It is a second
        /// `TextLabel.Layout` over the same string at the same width, so it
        /// resolves to the same index Litext's own (internal) one would —
        /// kept between presses because building it rebuilds a framesetter.
        private var hitTestLayout: (text: NSAttributedString, width: CGFloat, layout: TextLabel.Layout)?

        @objc func selectWord(_ recognizer: UILongPressGestureRecognizer) {
            guard recognizer.state == .began,
                  let view = recognizer.view as? MarkdownTextView
            else { return }
            let label = view.textLabelView
            guard label.isSelectable,
                  let range = wordRange(at: recognizer.location(in: label), in: label)
            else { return }

            label.selectionRange = range
            UISelectionFeedbackGenerator().selectionChanged()
        }

        private func wordRange(at point: CGPoint, in label: TextLabelView) -> NSRange? {
            let text = label.attributedText
            let size = label.bounds.size
            guard text.length > 0, size.width > 0, size.height > 0 else { return nil }

            let layout: TextLabel.Layout
            if let cached = hitTestLayout, cached.width == size.width, cached.text.isEqual(to: text) {
                layout = cached.layout
            } else {
                layout = TextLabel.Layout(attributedString: text)
                hitTestLayout = (text, size.width, layout)
            }
            // Litext lays out against the label's bounds and CoreText counts y
            // from the bottom, so the hit point is flipped the same way its own
            // `convertPointForTextLayout` flips it.
            layout.containerSize = size
            let flipped = CGPoint(x: point.x, y: size.height - point.y)

            guard let index = layout.nearestTextIndex(at: flipped) else { return nil }
            return Self.wordRange(in: text.string as NSString, at: index)
        }

        /// The word around `index`, falling back to the character there when
        /// the press lands on punctuation or whitespace between words.
        static func wordRange(in string: NSString, at index: Int) -> NSRange? {
            guard string.length > 0 else { return nil }
            let clamped = min(max(index, 0), string.length - 1)
            var result = string.rangeOfComposedCharacterSequence(at: clamped)
            string.enumerateSubstrings(
                in: NSRange(location: 0, length: string.length),
                options: [.byWords, .substringNotRequired]
            ) { _, range, _, stop in
                if range.location > clamped {
                    stop.pointee = true
                } else if NSLocationInRange(clamped, range) {
                    result = range
                    stop.pointee = true
                }
            }
            return result
        }
    }
}
#else
private struct MarkdownTextRepresentable: View {
    let text: String
    let theme: MarkdownTheme
    let typeSize: DynamicTypeSize
    let onLink: ((URL) -> Void)?
    var body: some View { MarkdownView(text, theme: theme) }
}
#endif

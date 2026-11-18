import SwiftUI
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

/// Palette that follows the system appearance. Every color here has a light
/// and a dark value; views never force a color scheme.
enum Theme {
    // Nuphos Design System v0.6, November 2026.
    static let canvas = adaptive(light: 0xF5F4F2, dark: 0x141312)
    static let surface = adaptive(light: 0xFCFBF9, dark: 0x1A1917)
    static let sunken = adaptive(light: 0xEEECE8, dark: 0x272624)
    static let heading = adaptive(light: 0x1C1A17, dark: 0xF2F0EC)
    static let body = adaptive(light: 0x5C5852, dark: 0xB8B4AD)
    static let muted = adaptive(light: 0x69645D, dark: 0xA09C95)
    static let link = adaptive(light: 0x2F4F7F, dark: 0x7C9CCB)
    static let success = adaptive(light: 0x2B7346, dark: 0x5FB57E)
    static let attention = adaptive(light: 0xB83A0A, dark: 0xF47A3F)
    static let warning = attention
    static let unread = heading
    static let badge = attention

    // Compatibility names keep existing controls on the shared palette.
    static let chatCanvas = surface
    /// Chips and cards inside the transcript, which `surface` cannot be
    /// because it matches the transcript's own light-mode background.
    static let chatSurface = adaptive(light: 0xF1F1F4, dark: 0x202024)
    static let bubble = sunken
    static let brand = heading
    static let brandText = link
    static let violet500 = body
    static let violet700 = heading
    static let selected = sunken
    static let control = sunken
    static let faint = muted
    static let outline = heading.opacity(0.12)
    static let hairline = heading.opacity(0.08)
    static let separator = heading.opacity(0.08)

    /// The tints a Bot's character may sit on (`avatar.*` in packages/design-tokens).
    /// The characters are drawn for light discs, so the tints stay light in the dark.
    private static let avatarBackgrounds: [String: Color] = [
        "sand": adaptive(light: 0xF2E7D3, dark: 0xF2E7D3),
        "peach": adaptive(light: 0xF8DCCB, dark: 0xF8DCCB),
        "rose": adaptive(light: 0xF6D5DE, dark: 0xF6D5DE),
        "lilac": adaptive(light: 0xE5DCF5, dark: 0xE5DCF5),
        "sky": adaptive(light: 0xD6E6F7, dark: 0xD6E6F7),
        "mint": adaptive(light: 0xD3EEDF, dark: 0xD3EEDF),
        "sage": adaptive(light: 0xE1E9D1, dark: 0xE1E9D1),
        "slate": adaptive(light: 0xE1E4EA, dark: 0xE1E4EA),
    ]

    /// The color a Bot's picked background paints; nil for none or a tint this build doesn't know.
    static func avatarBackground(_ name: String?) -> Color? { name.flatMap { avatarBackgrounds[$0] } }

    enum Space {
        static let small: CGFloat = 8
        static let medium: CGFloat = 12
        static let large: CGFloat = 16
        static let page: CGFloat = 20
    }
    enum Radius {
        static let button: CGFloat = 10
        static let card: CGFloat = 14
    }

    private static func adaptive(
        light: UInt32, dark: UInt32,
        lightAlpha: CGFloat = 1, darkAlpha: CGFloat = 1
    ) -> Color {
        #if canImport(UIKit)
        return Color(UIColor { traits in
            traits.userInterfaceStyle == .dark
                ? UIColor(hex: dark, alpha: darkAlpha)
                : UIColor(hex: light, alpha: lightAlpha)
        })
        #elseif canImport(AppKit)
        return Color(NSColor(name: nil) { appearance in
            let isDark = appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
            return isDark ? NSColor(hex: dark, alpha: darkAlpha) : NSColor(hex: light, alpha: lightAlpha)
        })
        #else
        return Color(hex: light)
        #endif
    }
}

extension View {
    /// The filled call-to-action. The app tints with `Theme.heading`, which
    /// is white in the dark — the color `.borderedProminent` draws its label
    /// in — so the fill takes the brand instead.
    func prominentButton() -> some View {
        buttonStyle(DesignPrimaryButtonStyle())
    }

    /// Liquid Glass on iOS 26 and later; a material in the same shape before.
    @ViewBuilder
    func glass(interactive: Bool = false, in shape: some Shape) -> some View {
        if #available(iOS 26, *) {
            glassEffect(interactive ? .regular.interactive() : .regular, in: shape)
        } else {
            background(.regularMaterial, in: shape)
        }
    }

    /// The glass call-to-action on iOS 26; the bordered one before it.
    @ViewBuilder
    func glassProminentButton() -> some View {
        if #available(iOS 26, *) {
            buttonStyle(.glassProminent)
        } else {
            buttonStyle(.borderedProminent)
        }
    }
}

extension Theme {
    /// Chat typography. Semantic text styles, so the whole scale follows
    /// Dynamic Type; sizes in the comments are the default (Large) ones.
    enum Text {
        /// Message prose — assistant answers and user bubbles. 16pt.
        static let body = Font.callout
        /// Supporting prose: thinking, plan steps, tool titles. 13pt.
        static let secondary = Font.footnote
        /// Activity and status lines. 13pt.
        static let label = Font.footnote
        /// Badges, timestamps and counters. 12pt.
        static let caption = Font.caption
        /// Chevrons and other glyphs set beside caption text. 11pt.
        static let micro = Font.caption2

        static func mono(_ style: Font.TextStyle) -> Font { .system(style, design: .monospaced) }

        /// Extra leading under each line of prose. CJK sets tighter than
        /// Latin at the same size and needs the room; it matches what the
        /// Markdown renderer puts between its own lines.
        static let leading: CGFloat = 4

        #if canImport(UIKit)
        /// The Markdown renderer is themed with `UIFont`s; these resolve the
        /// same styles at the reader's current text size.
        static func uiFont(_ style: UIFont.TextStyle, weight: UIFont.Weight = .regular) -> UIFont {
            let scaled = UIFont.preferredFont(forTextStyle: style)
            guard weight != .regular else { return scaled }
            return .systemFont(ofSize: scaled.pointSize, weight: weight)
        }

        static func italicUIFont(_ style: UIFont.TextStyle) -> UIFont {
            let scaled = UIFont.preferredFont(forTextStyle: style)
            guard let descriptor = scaled.fontDescriptor.withSymbolicTraits(.traitItalic) else { return scaled }
            return UIFont(descriptor: descriptor, size: scaled.pointSize)
        }

        static func monoUIFont(_ style: UIFont.TextStyle) -> UIFont {
            .monospacedSystemFont(ofSize: UIFont.preferredFont(forTextStyle: style).pointSize, weight: .regular)
        }
        #endif
    }
}

extension Color {
    init(hex: UInt32, opacity: Double = 1) {
        self.init(
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: opacity
        )
    }
}

#if canImport(UIKit)
private extension UIColor {
    convenience init(hex: UInt32, alpha: CGFloat) {
        self.init(
            red: CGFloat((hex >> 16) & 0xFF) / 255,
            green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255,
            alpha: alpha
        )
    }
}
#elseif canImport(AppKit)
private extension NSColor {
    convenience init(hex: UInt32, alpha: CGFloat) {
        self.init(
            srgbRed: CGFloat((hex >> 16) & 0xFF) / 255,
            green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255,
            alpha: alpha
        )
    }
}
#endif

extension View {
    /// Centers the content in a column no wider than comfortable reading,
    /// for wide windows. Narrower windows are unaffected.
    func readableWidth() -> some View {
        frame(maxWidth: 720).frame(maxWidth: .infinity)
    }
}

/// Shared filled action: ink, 10pt corners and a stable native touch target.
struct DesignPrimaryButtonStyle: ButtonStyle {
    var minimumHeight: CGFloat = 48
    @Environment(\.isEnabled) private var enabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.callout.weight(.medium))
            .padding(.horizontal, 16)
            .frame(minHeight: minimumHeight)
            .foregroundStyle(enabled ? Theme.surface : Theme.muted)
            .background(enabled ? Theme.heading : Theme.sunken, in: RoundedRectangle(cornerRadius: 10))
            .scaleEffect(configuration.isPressed && enabled ? 0.97 : 1)
    }
}

struct SetupEmptyState: View {
    let title: LocalizedStringKey
    let message: LocalizedStringKey
    let actionTitle: LocalizedStringKey
    let action: () -> Void
    var body: some View {
        VStack(spacing: 16) {
            Image("NuphosMark").resizable().scaledToFit().frame(width: 40, height: 40).accessibilityHidden(true)
            Text(title).font(.title3.weight(.semibold)).foregroundStyle(Theme.heading)
            Text(message).font(.callout).foregroundStyle(Theme.body).multilineTextAlignment(.center)
            Button(actionTitle, action: action).prominentButton().padding(.top, 4)
        }
        .padding(24).frame(maxWidth: 400).frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

struct RuntimeSetupGuide: View {
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    Text("Connect a computer").font(.title3.weight(.semibold)).foregroundStyle(Theme.heading)
                    Text("Your Bots and tasks need a runtime to work. Connect your computer with Nuphos Desktop, or ask a workspace administrator to share a runtime.").font(.callout).foregroundStyle(Theme.body)
                    VStack(alignment: .leading, spacing: 16) {
                        Text("1. Open Nuphos on your computer.")
                        Text("2. Sign in and choose this workspace.")
                        Text("3. Connect your computer and add a runtime.")
                    }.font(.callout).foregroundStyle(Theme.body).padding(20).frame(maxWidth: .infinity, alignment: .leading).background(Theme.surface, in: RoundedRectangle(cornerRadius: 14))
                    Link("Visit Nuphos", destination: URL(string: "https://nuphos.ai")!).prominentButton()
                }.padding(24)
            }.background(Theme.canvas)
            .navigationTitle("Runtime setup").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button { dismiss() } label: { LucideIcon("x") }.accessibilityLabel("Close") } }
        }
    }
}

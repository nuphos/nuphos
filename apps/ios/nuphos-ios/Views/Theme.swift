import SwiftUI
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

/// Palette that follows the system appearance. Every color here has a light
/// and a dark value; views never force a color scheme.
enum Theme {
    /// Page background: #F7F7F7 light, #141414 dark.
    static let canvas = adaptive(light: 0xF7F7F7, dark: 0x141414)
    /// Grouped rows / cards on top of the canvas.
    static let surface = adaptive(light: 0xFFFFFF, dark: 0x202024)
    /// The chat transcript reads like a page: #FFFFFF light, #141414 dark.
    static let chatCanvas = adaptive(light: 0xFFFFFF, dark: 0x141414)
    /// Chips and cards inside the transcript, which `surface` cannot be
    /// because it matches the transcript's own light-mode background.
    static let chatSurface = adaptive(light: 0xF1F1F4, dark: 0x202024)
    /// The user's own chat bubble: a shade off the canvas in either scheme.
    static let bubble = adaptive(light: 0xE9E9EC, dark: 0x2A2A2E)
    /// Brand violet (`--landing-brand`), brighter in the dark so it keeps contrast.
    static let brand = adaptive(light: 0x7D36EC, dark: 0x8B4DFF)
    /// Brand used as text/tint on the surfaces.
    static let brandText = adaptive(light: 0x6D28D9, dark: 0xA469FF)
    /// Unread reply dot — desktop's `bg-zViolet-500`, lifted in the dark
    /// the way `brand` is so it keeps contrast against #141414.
    static let unread = adaptive(light: 0x6300FF, dark: 0x8B4DFF)
    /// Avatar fallback gradient — zViolet-500 → zViolet-700.
    static let violet500 = Color(hex: 0x6300FF)
    static let violet700 = Color(hex: 0x3E14A2)

    static let heading = adaptive(light: 0x18181B, dark: 0xFFFFFF)
    static let body = adaptive(light: 0x52525B, dark: 0xA1A1AA)
    static let muted = adaptive(light: 0x84848C, dark: 0x71717A)
    /// Desktop `--color-warning`, darkened in light mode for contrast.
    static let warning = adaptive(light: 0xA04606, dark: 0xF5A623)
    static let hairline = adaptive(light: 0x18181B, dark: 0xFFFFFF, lightAlpha: 0.08, darkAlpha: 0.10)

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
        buttonStyle(.borderedProminent).tint(Theme.brand)
    }
}

extension Theme {
    /// Chat typography. Semantic text styles, so the whole scale follows
    /// Dynamic Type; sizes in the comments are the default (Large) ones.
    enum Text {
        /// Message prose — assistant answers and user bubbles. 17pt.
        static let body = Font.body
        /// Supporting prose: thinking, plan steps, tool titles. 15pt.
        static let secondary = Font.subheadline
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

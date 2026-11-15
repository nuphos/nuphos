import Foundation

/// GFM ends a bare URL only at ASCII whitespace, so the full-width punctuation
/// right after it in CJK prose — `…/pull/2595（Fixes #2594）` — and the word
/// after that become part of the link. A bare URL ends at its first non-ASCII
/// punctuation or space instead; CJK letters in a path still belong to it.
enum BareURL {
    /// The URL and the text after it, or nil when the whole literal is the URL.
    static func split(_ literal: String) -> (url: String, rest: String)? {
        guard let end = literal.firstIndex(where: { $0.unicodeScalars.first.map(breaks) ?? false }),
              end > literal.startIndex
        else { return nil }
        return (String(literal[..<end]), String(literal[end...]))
    }

    private static func breaks(_ scalar: Unicode.Scalar) -> Bool {
        guard !scalar.isASCII else { return false }
        switch scalar.properties.generalCategory {
        case .connectorPunctuation, .dashPunctuation, .openPunctuation, .closePunctuation,
             .initialPunctuation, .finalPunctuation, .otherPunctuation,
             .spaceSeparator, .lineSeparator, .paragraphSeparator:
            return true
        default:
            return false
        }
    }
}

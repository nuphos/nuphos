import Foundation

/// How a long user message folds in the transcript.
enum MessagePreview {
    /// The first lines of `text`, ending on a word, or nil when the message
    /// should show whole: it is short, or folding would hide too little to be
    /// worth a tap.
    static func head(of text: String) -> String? {
        var head = text.prefix(280)
            .split(separator: "\n", maxSplits: 6, omittingEmptySubsequences: false)
            .prefix(6)
            .joined(separator: "\n")
        // Cut inside a word: back up to the last space, if one is close.
        let cut = text.index(text.startIndex, offsetBy: head.count)
        if cut < text.endIndex, !text[cut].isWhitespace,
           let space = head.lastIndex(where: \.isWhitespace), head.distance(from: space, to: head.endIndex) < 40 {
            head = String(head[..<space])
        }
        let hidden = text[text.index(text.startIndex, offsetBy: head.count)...]
        guard hidden.count >= 100 || hidden.filter({ $0 == "\n" }).count >= 3 else { return nil }
        return head.trimmingCharacters(in: .whitespacesAndNewlines) + "…"
    }
}

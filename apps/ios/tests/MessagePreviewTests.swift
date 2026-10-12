import Foundation

enum MessagePreviewTests {
    static func run() {
        leavesShortMessagesWhole()
        foldsAtSixLines()
        foldsALongLineOnAWord()
        keepsAMessageJustOverTheLimitWhole()
        foldsManyShortLines()
        cutsInsideAWordWithoutNearbySpace()
        print("Message preview passed")
    }

    private static func leavesShortMessagesWhole() {
        precondition(MessagePreview.head(of: "") == nil)
        precondition(MessagePreview.head(of: "That fixed it, thanks!") == nil)
        precondition(MessagePreview.head(of: String(repeating: "a ", count: 140)) == nil, "exactly 280 characters")
    }

    private static func foldsAtSixLines() {
        let lines = (1...20).map { "line \($0) of a pasted log with some detail" }
        let head = MessagePreview.head(of: lines.joined(separator: "\n"))
        precondition(head == lines.prefix(6).joined(separator: "\n") + "…", "got \(head ?? "nil")")
    }

    private static func foldsALongLineOnAWord() {
        let text = String(repeating: "word ", count: 200)
        let head = MessagePreview.head(of: text) ?? ""
        precondition(head.hasSuffix("word…"), "got \(head.suffix(10))")
        precondition(head.count <= 281)
    }

    /// Ten hidden characters are not worth a Show more.
    private static func keepsAMessageJustOverTheLimitWhole() {
        precondition(MessagePreview.head(of: String(repeating: "a ", count: 145)) == nil)
        precondition(MessagePreview.head(of: (1...7).map { "line \($0)" }.joined(separator: "\n")) == nil)
    }

    private static func foldsManyShortLines() {
        let text = (1...20).map { "ok \($0)" }.joined(separator: "\n")
        precondition(MessagePreview.head(of: text) == "ok 1\nok 2\nok 3\nok 4\nok 5\nok 6…")
    }

    private static func cutsInsideAWordWithoutNearbySpace() {
        let text = String(repeating: "x", count: 1000)
        precondition(MessagePreview.head(of: text) == String(repeating: "x", count: 280) + "…")
    }
}

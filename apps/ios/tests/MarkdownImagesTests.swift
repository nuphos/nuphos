import Foundation

enum MarkdownImagesTests {
    static func run() {
        leavesTextWithoutImagesWhole()
        splitsAroundImageLines()
        keepsInlineAndFencedImages()
        recognisesCitedReplyFiles()
        print("Markdown images passed")
    }

    private static let shot = URL(string: "https://raw.githubusercontent.com/nuphos/pr-assets/abc/before.png")!

    private static func leavesTextWithoutImagesWhole() {
        let text = "Plain **answer** with a [link](https://example.com)."
        precondition(MarkdownImages.segments(of: text) == [.markdown(text)])
    }

    private static func splitsAroundImageLines() {
        let text = "**Before**\n\n![#1004 before](\(shot.absoluteString))\n\n![a](\(shot.absoluteString)) ![b](\(shot.absoluteString))\n\nDone."
        let segments = MarkdownImages.segments(of: text)
        precondition(segments == [
            .markdown("**Before**\n"),
            .image(shot, alt: "#1004 before"),
            .image(shot, alt: "a"),
            .image(shot, alt: "b"),
            .markdown("\nDone."),
        ], "got \(segments)")
    }

    private static func keepsInlineAndFencedImages() {
        for text in [
            "See ![x](\(shot.absoluteString)) here.",
            "```md\n![x](\(shot.absoluteString))\n```",
            "    ![x](\(shot.absoluteString))",
            "![x](http://example.com/a.png)",
        ] {
            precondition(MarkdownImages.segments(of: text) == [.markdown(text)], text)
        }
    }

    private static func recognisesCitedReplyFiles() {
        let id = "0123456789abcdef01234567"
        precondition(MarkdownImages.replyGroupId(URL(string: "https://nuphos.ai/_reply-images/\(id)")!) == id)
        precondition(MarkdownImages.replyGroupId(shot) == nil)
        precondition(MarkdownImages.replyGroupId(URL(string: "https://example.com/_reply-images/\(id)")!) == nil)
        precondition(MarkdownImages.replyGroupId(URL(string: "https://nuphos.ai/_reply-images/abc")!) == nil)
        precondition(MarkdownImages.replyGroupId(URL(string: "https://nuphos.ai/_reply-images/\(id)/x")!) == nil)
        precondition(MarkdownImages.cites("See ![shot](https://nuphos.ai/_reply-images/\(id))", groupId: id))
    }
}

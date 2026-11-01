import Foundation

/// The Markdown renderer draws `![alt](url)` as the URL's text. An answer is
/// split around the lines that hold only https images, so those can be shown
/// as images, the way Desktop and Android already show them. An image in the
/// middle of a sentence, or in a code block, stays as written.
enum MarkdownImages {
    enum Segment: Equatable {
        case markdown(String)
        case image(URL, alt: String)
    }

    private static let image = try! NSRegularExpression(pattern: #"!\[([^\]\n]*)\]\((https://[^\s()]+)\)"#)

    static func segments(of text: String) -> [Segment] {
        guard text.contains("![") else { return [.markdown(text)] }
        var segments: [Segment] = []
        var lines: [Substring] = []
        var fence: Substring?

        func flush() {
            let markdown = lines.joined(separator: "\n")
            if !markdown.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                segments.append(.markdown(markdown))
            }
            lines = []
        }

        for line in text.split(separator: "\n", omittingEmptySubsequences: false) {
            let trimmed = line.drop(while: { $0 == " " })
            if let open = fence {
                if trimmed.hasPrefix(open) { fence = nil }
            } else if trimmed.hasPrefix("```") || trimmed.hasPrefix("~~~") {
                fence = trimmed.prefix(3)
            } else if line.count - trimmed.count < 4, let images = imagesOnly(String(trimmed)) {
                flush()
                segments += images
                continue
            }
            lines.append(line)
        }
        flush()
        return segments.isEmpty ? [.markdown(text)] : segments
    }

    /// The images on a line that holds nothing else.
    private static func imagesOnly(_ line: String) -> [Segment]? {
        let range = NSRange(line.startIndex..., in: line)
        let matches = image.matches(in: line, range: range)
        guard !matches.isEmpty,
              image.stringByReplacingMatches(in: line, range: range, withTemplate: "")
                  .allSatisfy(\.isWhitespace)
        else { return nil }
        return matches.compactMap { match in
            guard let alt = Range(match.range(at: 1), in: line),
                  let src = Range(match.range(at: 2), in: line),
                  let url = URL(string: String(line[src]))
            else { return nil }
            return .image(url, alt: String(line[alt]))
        }
    }
}

import Foundation

enum BareURLTests {
    static func run() {
        let pr = "https://github.com/nuphos/nuphos/pull/2595"
        for tail in ["（Fixes", "，下一句", "。", "、b", "：", "「x」", "\u{3000}next"] {
            let split = BareURL.split(pr + tail)
            precondition(split?.url == pr && split?.rest == tail, "\(tail): \(String(describing: split))")
        }
        for url in [pr, "https://zh.wikipedia.org/wiki/台灣", "https://example.com/a?b=c,d"] {
            precondition(BareURL.split(url) == nil, url)
        }
        print("Bare URLs passed")
    }
}

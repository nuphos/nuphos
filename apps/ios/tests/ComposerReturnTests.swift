import Foundation

enum ComposerReturnTests {
    static func run() {
        expect(.on(modified: false, composing: false), .send, "Return")
        expect(.on(modified: true, composing: false), .textView, "Shift-Return")
        // An input method's candidate is committed, never sent or dropped.
        expect(.on(modified: false, composing: true), .textView, "Return while composing")
        expect(.on(modified: true, composing: true), .textView, "Shift-Return while composing")
        print("Composer Return passed")
    }

    private static func expect(_ got: ComposerReturn, _ want: ComposerReturn, _ what: String) {
        precondition(got == want, "\(what): expected \(want), got \(got)")
    }
}

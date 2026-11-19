import SwiftUI

enum ComposerReturnTests {
    static func run() {
        expect(.on([], composing: false), .send, "Return")
        expect(.on(.shift, composing: false), .textView, "Shift-Return")
        // An input method's candidate is committed, never sent or dropped.
        expect(.on([], composing: true), .textView, "Return while composing")
        expect(.on(.shift, composing: true), .textView, "Shift-Return while composing")
        expect(.on(.capsLock, composing: false), .send, "Return with Caps Lock on")
        expect(.on(.numericPad, composing: false), .send, "Enter on the numeric keypad")
        expect(.on([.capsLock, .shift], composing: false), .textView, "Shift-Return with Caps Lock on")
        print("Composer Return passed")
    }

    private static func expect(_ got: ComposerReturn, _ want: ComposerReturn, _ what: String) {
        precondition(got == want, "\(what): expected \(want), got \(got)")
    }
}

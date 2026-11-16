import SwiftUI

/// What Return on a hardware keyboard does in the composer, as in Messages on
/// iPad (#2154). The on-screen keyboard's Return never arrives as a key press:
/// it types a line break, as it always has.
enum ComposerReturn: Equatable {
    /// The draft is sent.
    case send
    /// The text view keeps the key: Shift-Return types a line break, and an
    /// input method that is still composing commits its candidate, so nothing
    /// typed is lost.
    case textView

    /// Caps Lock and the numeric keypad's Enter are not held modifiers, so
    /// they still send.
    static func on(_ modifiers: EventModifiers, composing: Bool) -> ComposerReturn {
        composing || !modifiers.isDisjoint(with: [.shift, .control, .option, .command]) ? .textView : .send
    }
}

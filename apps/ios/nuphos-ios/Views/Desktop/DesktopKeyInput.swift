import GameController
import SwiftUI
import UIKit

/// The hidden text view that takes the keyboard while the desktop is taken
/// over. Typed text reaches the computer once it is committed, so Chinese,
/// Japanese and other input methods compose here first, as does dictation.
/// With a hardware keyboard attached it takes the keys without raising the
/// on-screen keyboard.
struct DesktopKeyInput: UIViewRepresentable {
    let desktop: DesktopSession
    /// The on-screen keyboard is wanted.
    @Binding var shown: Bool

    func makeUIView(context: Context) -> DesktopKeyInputView {
        let view = DesktopKeyInputView(desktop: desktop)
        view.dismissed = { shown = false }
        return view
    }

    func updateUIView(_ view: DesktopKeyInputView, context: Context) {
        view.update(enabled: desktop.controlling, softKeyboard: shown)
    }
}

final class DesktopKeyInputView: UITextView, UITextViewDelegate {
    /// Kept in the view so a backspace always has something to delete.
    private static let placeholder = "\u{200B}"
    private let desktop: DesktopSession
    private var enabled = false
    private var softKeyboard = false
    private var held: [UIPress: [UInt32]] = [:]
    var dismissed: (() -> Void)?

    init(desktop: DesktopSession) {
        self.desktop = desktop
        super.init(frame: .zero, textContainer: nil)
        delegate = self
        text = Self.placeholder
        backgroundColor = .clear
        textColor = .clear
        tintColor = .clear
        isScrollEnabled = false
        autocorrectionType = .no
        autocapitalizationType = .none
        spellCheckingType = .no
        smartQuotesType = .no
        smartDashesType = .no
        smartInsertDeleteType = .no
        inlinePredictionType = .no
        inputAssistantItem.leadingBarButtonGroups = []
        inputAssistantItem.trailingBarButtonGroups = []
        for name in [Notification.Name.GCKeyboardDidConnect, .GCKeyboardDidDisconnect] {
            NotificationCenter.default.addObserver(self, selector: #selector(keyboardsChanged), name: name, object: nil)
        }
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    @objc private func keyboardsChanged() { refresh() }

    func update(enabled: Bool, softKeyboard: Bool) {
        guard enabled != self.enabled || softKeyboard != self.softKeyboard else { return }
        self.enabled = enabled
        self.softKeyboard = softKeyboard
        refresh()
    }

    private func refresh() {
        let hardware = GCKeyboard.coalesced != nil
        guard enabled, softKeyboard || hardware else {
            if isFirstResponder { _ = resignFirstResponder() }
            return
        }
        // An empty input view keeps the on-screen keyboard down while a
        // hardware keyboard types.
        let wanted: UIView? = softKeyboard ? nil : UIView(frame: .zero)
        if (inputView == nil) != (wanted == nil) {
            inputView = wanted
            if isFirstResponder { reloadInputViews() }
        }
        if !isFirstResponder { _ = becomeFirstResponder() }
    }

    override func resignFirstResponder() -> Bool {
        let resigned = super.resignFirstResponder()
        if resigned, softKeyboard { softKeyboard = false; dismissed?() }
        for keys in held.values { releaseKeys(keys) }
        held = [:]
        return resigned
    }

    func textView(_ textView: UITextView, shouldChangeTextIn range: NSRange, replacementText replacement: String) -> Bool {
        guard markedTextRange == nil, replacement.isEmpty, range.length > 0 else { return true }
        desktop.key(RFBKeysym.backspace)
        return false
    }

    func textViewDidChange(_ textView: UITextView) {
        guard markedTextRange == nil else { return }
        let typed = text.replacingOccurrences(of: Self.placeholder, with: "")
        text = Self.placeholder
        if !typed.isEmpty { desktop.type(typed) }
    }

    // MARK: - Hardware keys

    /// Keys that have no text, and any key with ⌘, ⌃ or ⌥, go to the computer
    /// as key presses; the rest type through the text view.
    override func pressesBegan(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
        var typing = Set<UIPress>()
        for press in presses {
            guard enabled, let key = press.key, let keysym = Self.keysym(key) else { typing.insert(press); continue }
            let keys = Self.modifiers(key.modifierFlags) + [keysym]
            held[press] = keys
            for key in keys { desktop.key(key, down: true) }
        }
        if !typing.isEmpty { super.pressesBegan(typing, with: event) }
    }

    override func pressesEnded(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
        super.pressesEnded(lift(presses), with: event)
    }

    override func pressesCancelled(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
        super.pressesCancelled(lift(presses), with: event)
    }

    /// Releases the presses this view sent and returns the others.
    private func lift(_ presses: Set<UIPress>) -> Set<UIPress> {
        var others = Set<UIPress>()
        for press in presses {
            if let keys = held.removeValue(forKey: press) { releaseKeys(keys) } else { others.insert(press) }
        }
        return others
    }

    private func releaseKeys(_ keys: [UInt32]) {
        for key in keys.reversed() { desktop.key(key, down: false) }
    }

    private static func modifiers(_ flags: UIKeyModifierFlags) -> [UInt32] {
        [(UIKeyModifierFlags.shift, RFBKeysym.shift), (.control, RFBKeysym.control), (.alternate, RFBKeysym.option), (.command, RFBKeysym.command)]
            .filter { flags.contains($0.0) }
            .map(\.1)
    }

    private static func keysym(_ key: UIKey) -> UInt32? {
        switch key.keyCode {
        case .keyboardEscape: return RFBKeysym.escape
        case .keyboardTab: return RFBKeysym.tab
        case .keyboardLeftArrow: return RFBKeysym.left
        case .keyboardRightArrow: return RFBKeysym.right
        case .keyboardUpArrow: return RFBKeysym.up
        case .keyboardDownArrow: return RFBKeysym.down
        case .keyboardHome: return RFBKeysym.home
        case .keyboardEnd: return RFBKeysym.end
        case .keyboardPageUp: return RFBKeysym.pageUp
        case .keyboardPageDown: return RFBKeysym.pageDown
        case .keyboardDeleteForward: return RFBKeysym.delete
        default: break
        }
        let functionKeys: [UIKeyboardHIDUsage] = [.keyboardF1, .keyboardF2, .keyboardF3, .keyboardF4, .keyboardF5, .keyboardF6, .keyboardF7, .keyboardF8, .keyboardF9, .keyboardF10, .keyboardF11, .keyboardF12]
        if let index = functionKeys.firstIndex(of: key.keyCode) { return RFBKeysym.function(index + 1) }
        guard !key.modifierFlags.isDisjoint(with: [.command, .control, .alternate]),
              let scalar = key.charactersIgnoringModifiers.lowercased().unicodeScalars.first else { return nil }
        return RFBKeysym.character(scalar)
    }
}

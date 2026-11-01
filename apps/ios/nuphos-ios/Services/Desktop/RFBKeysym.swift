import Foundation

/// X11 keysyms, which RFB key events carry.
nonisolated enum RFBKeysym {
    static let backspace: UInt32 = 0xFF08
    static let tab: UInt32 = 0xFF09
    static let `return`: UInt32 = 0xFF0D
    static let escape: UInt32 = 0xFF1B
    static let home: UInt32 = 0xFF50
    static let left: UInt32 = 0xFF51
    static let up: UInt32 = 0xFF52
    static let right: UInt32 = 0xFF53
    static let down: UInt32 = 0xFF54
    static let pageUp: UInt32 = 0xFF55
    static let pageDown: UInt32 = 0xFF56
    static let end: UInt32 = 0xFF57
    static let delete: UInt32 = 0xFFFF
    static let shift: UInt32 = 0xFFE1
    static let control: UInt32 = 0xFFE3
    static let option: UInt32 = 0xFFE9
    /// Super, which noVNC also sends for ⌘ and macOS Screen Sharing reads as Command.
    static let command: UInt32 = 0xFFEB
    static func function(_ number: Int) -> UInt32 { 0xFFBE + UInt32(number - 1) }

    /// The keysym that types one character: Latin-1 as itself, other
    /// characters as Unicode keysyms, and control characters as their keys.
    static func character(_ scalar: Unicode.Scalar) -> UInt32 {
        switch scalar.value {
        case 0x08: backspace
        case 0x09: tab
        case 0x0A, 0x0D: `return`
        case 0x1B: escape
        case 0x7F: delete
        case 0x20...0x7E, 0xA0...0xFF: scalar.value
        default: 0x0100_0000 + scalar.value
        }
    }
}

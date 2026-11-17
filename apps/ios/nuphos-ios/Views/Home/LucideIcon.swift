import SwiftUI

/// Official Lucide SVGs, bundled as template assets so tint stays consistent.
struct LucideIcon: View {
    let name: String
    var size: CGFloat = 16

    init(_ name: String, size: CGFloat = 16) {
        self.name = name
        self.size = size
    }

    init(systemName: String, size: CGFloat = 16) {
        self.name = Self.systemSymbols[systemName] ?? "circle-help"
        self.size = size
    }

    private static let systemSymbols: [String: String] = [
    "arrow.turn.up.right": "corner-down-right",
    "bubble.left.and.bubble.right": "message-circle",
    "chart.xyaxis.line": "layers",
    "waveform.path.ecg": "layers",
    "square.on.square": "layers",
    "play.rectangle.fill": "play",
    "doc.on.clipboard": "clipboard-list",
    "lock.slash": "lock",
    "xmark": "x",
    "chevron.right": "chevron-right",
    "wifi.exclamationmark": "wifi-off",
    "checkmark": "check",
    "checkmark.circle.fill": "circle-check",
    "exclamationmark.circle": "circle-alert",
    "macbook": "laptop",
    "xmark.circle.fill": "circle-x",
    "cpu": "cpu",
    "archivebox": "archive",
    "exclamationmark.triangle.fill": "triangle-alert",
    "slider.horizontal.3": "sliders-horizontal",
    "brain": "brain",
    "square.and.arrow.up": "share",
    "bubble.left": "message-circle",
    "hand.raised.fill": "hand",
    "plus": "plus",
    "key": "key-round",
    "message": "message-circle",
    "pencil": "pencil",
    "chevron.down": "chevron-down",
    "exclamationmark.circle.fill": "circle-alert",
    "arrow.up": "arrow-up",
    "arrow.up.right": "arrow-up-right",
    "exclamationmark.triangle": "triangle-alert",
    "link": "link",
    "globe": "globe",
    "exclamationmark.bubble": "message-circle-warning",
    "arrow.left.arrow.right": "arrow-left-right",
    "ellipsis": "ellipsis",
    "arrow.clockwise": "rotate-cw",
    "list.clipboard": "clipboard-list",
    "circle": "circle",
    "nosign": "ban",
    "gearshape": "settings",
    "key.fill": "key-round",
    "person.badge.key": "key-round",
    "app.connected.to.app.below.fill": "blocks",
    "tray": "inbox",
    "laptopcomputer": "laptop",
    "person.2": "users",
    "link.badge.minus": "unlink",
    "square.and.pencil": "square-pen",
    "doc": "file",
    "mic": "mic",
    "stop.fill": "square",
    "pin.slash": "pin-off",
    "pin": "pin",
    "arrow.down": "arrow-down",
    "arrowshape.turn.up.left.circle.fill": "undo-2",
    "person.crop.circle.badge.plus": "user-plus",
    "person.circle": "circle-user-round",
    "hand.wave": "hand",
    "sparkles": "sparkles",
    "text.badge.plus": "text-cursor-input",
    "arrow.turn.down.right": "corner-down-right",
    "play.fill": "play",
    "person.crop.circle.badge.questionmark": "user-round-search",
    "chevron.backward": "chevron-left",
    "chevron.forward": "chevron-right",
    "rectangle.on.rectangle": "panels-top-left",
    "xmark.square": "square-x",
    "ellipsis.circle": "circle-ellipsis",
    "display": "monitor",
    "arrowshape.turn.up.left": "undo-2",
    "text.cursor": "text-cursor",
    "doc.on.doc": "copy",
    "pause.fill": "pause",
    "arrowshape.turn.up.left.fill": "undo-2",
    "lock.fill": "lock",
    "person.badge.minus": "user-minus",
    "chevron.up.chevron.down": "chevrons-up-down",
    "plus.circle": "circle-plus",
    "lock.shield": "shield",
    "list.number": "list-ordered",
    "dollarsign.circle": "circle-dollar-sign",
    "shield": "shield",
    "checkmark.shield": "shield-check",
    "circle.lefthalf.filled": "contrast",
    "terminal": "terminal",
    "hand.point.up.left": "mouse-pointer-2",
    "display.trianglebadge.exclamationmark": "monitor-x",
    "bell.slash": "bell-off",
    "bell": "bell",
    "person.crop.circle.badge.minus": "user-round-minus",
    "cloud": "cloud",
    "shippingbox": "package",
    "hourglass": "hourglass",
    "keyboard": "keyboard",
    "keyboard.chevron.compact.down": "keyboard",
    "bolt.fill": "zap",
    "person": "user-round",
    "macwindow": "app-window",
    "menubar.dock.rectangle": "panels-top-left",
    "tray.and.arrow.up": "archive-restore",
    "hand.raised.slash": "hand",
    "chevron.up": "chevron-up",
    "questionmark.circle": "circle-help",
    "folder": "folder",
    "doc.text": "file-text",
    "photo": "image",
    "film": "film",
    "music.note": "music",
    "doc.zipper": "file-archive",
    "paperclip": "paperclip",
    "square.and.arrow.down": "download",
    "folder.fill": "folder",
    "arrow.up.circle.fill": "circle-arrow-up",
    "arrow.up.right.square": "external-link",
    "rectangle.stack": "layers",
    "magnifyingglass": "search",
    "tray.full": "inbox"
]

    var body: some View {
        Image("lucide-\(name)")
            .resizable()
            .scaledToFit()
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}

/// Semantic labels use the same icon sizes and text tones across menus and lists.
struct DesignLabel: View {
    private let title: Text
    private let symbol: String
    init(_ title: LocalizedStringKey, systemImage: String) {
        self.title = Text(title)
        self.symbol = systemImage
    }
    init(_ title: String, systemImage: String) {
        self.title = Text(title)
        self.symbol = systemImage
    }
    var body: some View {
        Label { title } icon: { LucideIcon(systemName: symbol, size: 14) }
    }
}

struct DesignButton: View {
    private let title: Text
    private let image: String
    private let role: ButtonRole?
    private let action: () -> Void
    init(_ title: LocalizedStringKey, image: String, role: ButtonRole? = nil, action: @escaping () -> Void) {
        self.title = Text(title); self.image = image; self.role = role; self.action = action
    }
    init(_ title: String, image: String, role: ButtonRole? = nil, action: @escaping () -> Void) {
        self.title = Text(title); self.image = image; self.role = role; self.action = action
    }
    var body: some View {
        Button(role: role, action: action) {
            Label { title } icon: { Image(image) }
        }
    }
}

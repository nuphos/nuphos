import SwiftTerm
import SwiftUI

/// A conversation's runtime terminal, full screen or in a pane beside it, as the desktop is.
/// A hardware keyboard types into it directly; a tap brings up the on-screen one.
struct TerminalScreen: View {
    let terminal: TerminalSession
    /// Closes the screen; its presenter passes this, as for the desktop.
    let close: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Button(action: close) {
                    Image(systemName: "xmark")
                        .font(.system(size: 15, weight: .semibold))
                        .frame(width: 36, height: 36)
                        .background(Circle().fill(Color.white.opacity(0.12)))
                }
                .accessibilityLabel("Close terminal")
                Text(title).font(Theme.Text.label.weight(.semibold)).lineLimit(1)
                Spacer()
            }
            .foregroundStyle(.white)
            .padding(8)
            TerminalSurface(terminal: terminal)
                .padding(.horizontal, 6)
                .accessibilityIdentifier("runtime-terminal")
        }
        .overlay { status }
        .background(Color.black.ignoresSafeArea())
        // Dark here only: in a pane, the conversation beside it keeps its own.
        .environment(\.colorScheme, .dark)
    }

    private var title: String {
        if case .live(let label) = terminal.phase { return label }
        return "Terminal"
    }

    @ViewBuilder
    private var status: some View {
        switch terminal.phase {
        case .connecting:
            ProgressView("Connecting…")
                .tint(.white)
                .foregroundStyle(.white.opacity(0.7))
        case .live:
            EmptyView()
        case .ended:
            notice("The shell ended.", retry: "Open again")
        case .failed(let message):
            notice(message, retry: "Try again")
        }
    }

    private func notice(_ message: String, retry: String) -> some View {
        VStack(spacing: 14) {
            Image(systemName: "terminal")
                .font(.system(size: 34, weight: .light))
            Text(message)
                .font(Theme.Text.secondary)
                .multilineTextAlignment(.center)
            HStack(spacing: 12) {
                Button("Close", action: close)
                    .buttonStyle(.bordered)
                Button(retry) { terminal.retry() }
                    .buttonStyle(.borderedProminent)
                    .tint(Theme.brand)
            }
        }
        .foregroundStyle(.white)
        .padding(28)
        .frame(maxWidth: 360)
        .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Color(white: 0.12)))
        .padding(24)
    }
}

/// SwiftTerm's terminal, fed by the session and typing into it.
private struct TerminalSurface: UIViewRepresentable {
    let terminal: TerminalSession

    func makeCoordinator() -> Coordinator { Coordinator(terminal: terminal) }

    func makeUIView(context: Context) -> TerminalView {
        let view = TerminalView(frame: .zero, font: UIFont.monospacedSystemFont(ofSize: 13, weight: .regular))
        view.nativeBackgroundColor = .black
        view.nativeForegroundColor = .white
        view.terminalDelegate = context.coordinator
        // A new view as the pane moves to full screen and back: it starts from what came before.
        view.feed(byteArray: terminal.scrollback[...])
        terminal.onOutput = { [weak view] bytes in view?.feed(byteArray: bytes[...]) }
        // Ready for a hardware keyboard without a tap first.
        DispatchQueue.main.async { _ = view.becomeFirstResponder() }
        return view
    }

    func updateUIView(_ view: TerminalView, context: Context) {}

    final class Coordinator: @preconcurrency TerminalViewDelegate {
        let terminal: TerminalSession

        init(terminal: TerminalSession) { self.terminal = terminal }

        func send(source: TerminalView, data: ArraySlice<UInt8>) { terminal.input(data) }
        func sizeChanged(source: TerminalView, newCols: Int, newRows: Int) { terminal.resize(cols: newCols, rows: newRows) }
        func clipboardCopy(source: TerminalView, content: Data) {
            if let text = String(data: content, encoding: .utf8) { UIPasteboard.general.string = text }
        }
        func setTerminalTitle(source: TerminalView, title: String) {}
        func hostCurrentDirectoryUpdate(source: TerminalView, directory: String?) {}
        func scrolled(source: TerminalView, position: Double) {}
        func requestOpenLink(source: TerminalView, link: String, params: [String: String]) {}
        func rangeChanged(source: TerminalView, startY: Int, endY: Int) {}
    }
}

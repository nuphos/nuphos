import SwiftUI

@main
struct NuphosApp: App {
    #if canImport(UIKit)
    @UIApplicationDelegateAdaptor(PushAppDelegate.self) private var pushDelegate
    #endif
    @State private var session = AuthSession()

    var body: some Scene {
        WindowGroup {
            #if DEBUG && os(iOS)
            if CommandLine.arguments.contains("-scroll-regression") {
                TranscriptRegressionScreen()
            } else if CommandLine.arguments.contains("-preview-desktop") {
                // With `-apiBaseURL http://127.0.0.1:<port>` pointing at a fixture desktop server.
                PreviewDesktop()
            } else {
                RootView()
                    .environment(session)
            }
            #else
            RootView()
                .environment(session)
            #endif
        }
        .commands { NewChatCommand() }
    }
}

extension FocusedValues {
    /// Opens the new-chat composer in the focused window.
    @Entry var newChat: (() -> Void)?
}

/// ⌘N, listed in the menu bar.
private struct NewChatCommand: Commands {
    @FocusedValue(\.newChat) private var newChat

    var body: some Commands {
        CommandGroup(replacing: .newItem) {
            Button("New Agent") { newChat?() }
                .keyboardShortcut("n")
                .disabled(newChat == nil)
        }
    }
}

#if DEBUG && os(iOS)
/// A stand-in conversation with its desktop open, presented as HomeView presents one: beside the
/// conversation where the window is wide, else full screen, with "Open desktop" once it is closed.
private struct PreviewDesktop: View {
    @State private var desktop: DesktopSession? = Self.make()
    @State private var columns = NavigationSplitViewVisibility.automatic
    @Environment(\.horizontalSizeClass) private var sizeClass

    private static func make() -> DesktopSession { DesktopSession(teamId: "preview", sessionId: "preview", token: "preview") }

    var body: some View {
        NavigationSplitView(columnVisibility: $columns, preferredCompactColumn: .constant(.detail)) {
            List { Text("Preview agent") }.navigationTitle("Agents")
        } detail: {
            VStack(spacing: 12) {
                Text("The conversation stays here.").foregroundStyle(Theme.muted)
                if desktop == nil { Button("Open desktop") { desktop = Self.make() } }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .desktop($desktop)
            .navigationTitle("Preview agent")
            .navigationBarTitleDisplayMode(.inline)
        }
        .environment(\.desktopBeside, sizeClass == .regular ? { open in columns = open ? .detailOnly : .automatic } : nil)
        .onAppear {
            // `-preview-landscape`: held sideways, for the simulator's screenshots.
            guard CommandLine.arguments.contains("-preview-landscape"),
                  let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene else { return }
            scene.requestGeometryUpdate(.iOS(interfaceOrientations: .landscapeRight))
        }
    }
}
#endif

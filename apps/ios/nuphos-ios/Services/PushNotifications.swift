import Foundation
import Observation
import UserNotifications
#if canImport(UIKit)
import UIKit
#endif

/// A conversation a notification or a session link points at.
struct PushTarget: Equatable, Hashable, Identifiable {
    let teamId: String
    let sessionId: String
    let title: String
    var id: String { "\(teamId)/\(sessionId)" }

    init(teamId: String, sessionId: String, title: String = "Agent") {
        self.teamId = teamId
        self.sessionId = sessionId
        self.title = title
    }

    nonisolated init?(userInfo: [AnyHashable: Any]) {
        guard let teamId = userInfo["teamId"] as? String, !teamId.isEmpty,
              let sessionId = userInfo["sessionId"] as? String, !sessionId.isEmpty else { return nil }
        self.teamId = teamId
        self.sessionId = sessionId
        let alert = (userInfo["aps"] as? [String: Any])?["alert"] as? [String: Any]
        title = alert?["title"] as? String ?? "Agent"
    }
}

/// APNs registration and notification routing. The device token is sent to
/// the backend once someone is signed in; a tapped notification or link
/// becomes `pendingTarget` for the Agent page to open, or `pendingPlan`.
@Observable
final class PushNotifications: NSObject, UNUserNotificationCenterDelegate {
    static let shared = PushNotifications()

    var pendingTarget: PushTarget?
    var pendingPlan: PlanLink.Target?
    /// The Live Activity was tapped outside its rows: show the conversation list.
    var pendingConversations = false

    /// Shows a nuphos.ai page in-app — a link tapped in a chat or one that
    /// opened the app. False when the app has no screen for it.
    @discardableResult
    func open(_ url: URL) -> Bool {
        switch AppLink(url) {
        case .session(let teamId, let sessionId): pendingTarget = PushTarget(teamId: teamId, sessionId: sessionId)
        case .plan(let plan): pendingPlan = plan
        case .conversations: pendingConversations = true
        case nil: return false
        }
        return true
    }

    @ObservationIgnored private var authToken: String?
    @ObservationIgnored private var deviceToken: String?
    @ObservationIgnored private var registeredPair: String?

    private static var deviceId: String {
        #if canImport(UIKit)
        UIDevice.current.identifierForVendor?.uuidString ?? "unknown"
        #else
        "unknown"
        #endif
    }

    static var environment: String {
        #if DEBUG
        "sandbox"
        #else
        "production"
        #endif
    }

    func install() {
        UNUserNotificationCenter.current().delegate = self
    }

    /// Called once a session is signed in: asks for permission (the system
    /// only prompts the first time) and registers with APNs.
    func activate(authToken: String) async {
        self.authToken = authToken
        #if DEBUG
        // Simulator scripts cannot answer the permission alert, and it blocks links.
        if CommandLine.arguments.contains("-preview-no-push") { return }
        #endif
        let granted = (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])) ?? false
        guard granted else { return }
        #if canImport(UIKit)
        UIApplication.shared.registerForRemoteNotifications()
        #endif
        await upload()
    }

    /// Unregisters this device before the session token is discarded, so a
    /// signed-out phone stops receiving the previous user's notifications.
    func deactivate() async {
        let authToken = self.authToken
        self.authToken = nil
        pendingTarget = nil
        pendingPlan = nil
        registeredPair = nil
        guard let authToken, let deviceToken else { return }
        try? await AgentChatAPI.unregisterPushDevice(token: authToken, deviceToken: deviceToken)
    }

    func didRegister(deviceToken data: Data) {
        deviceToken = data.map { String(format: "%02x", $0) }.joined()
        Task { await upload() }
    }

    private func upload() async {
        guard let authToken, let deviceToken else { return }
        let pair = "\(authToken)/\(deviceToken)"
        guard pair != registeredPair else { return }
        do {
            try await AgentChatAPI.registerPushDevice(
                token: authToken,
                device: .init(token: deviceToken, deviceId: Self.deviceId, environment: Self.environment,
                              bundleId: Bundle.main.bundleIdentifier ?? "")
            )
            registeredPair = pair
        } catch {
            // Retried on the next launch or token refresh.
        }
    }

    // MARK: - UNUserNotificationCenterDelegate

    // UIKit's response completion can update a background scene snapshot.
    // The async delegate bridge resumes its Objective-C completion off-main;
    // that aborts with "Call must be made on main thread" on a notification tap.
    // Use explicit callbacks and finish on MainActor, including invalid payloads.
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter, willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        let content = notification.request.content
        let hasAlert = !content.title.isEmpty || !content.body.isEmpty
        let target = PushTarget(userInfo: content.userInfo)
        Task { @MainActor in
            if !hasAlert || target.map({ ConversationUnread.shared.isReading(team: $0.teamId, session: $0.sessionId) }) == true {
                completionHandler([.badge])
            } else {
                completionHandler([.banner, .list, .sound, .badge])
            }
        }
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let target = PushTarget(userInfo: response.notification.request.content.userInfo)
        Task { @MainActor in
            if let target { PushNotifications.shared.pendingTarget = target }
            completionHandler()
        }
    }

}

#if canImport(UIKit)
final class PushAppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        PushNotifications.shared.install()
        #if os(iOS)
        TurnLiveActivity.dropExtras()
        #endif
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        PushNotifications.shared.didRegister(deviceToken: deviceToken)
    }
}
#endif

import Foundation
import PostHog

/// Product events only: no automatic view/tap capture, replay, prompts or URLs.
/// Identity is the same backend user ID used by Desktop and server events.
@MainActor
final class Analytics {
    static let shared = Analytics()

    private var started = false
    private var userID: String?
    private var active = false
    private var currentScreen: (name: String, teamID: String?)?

    private var enabled: Bool {
        #if DEBUG
        return false
        #else
        // Self-hosted users must never be sent to Nuphos Cloud analytics.
        return NuphosAPI.baseURL == NuphosAPI.defaultBaseURL
        #endif
    }

    func identify(_ user: NuphosUser) {
        guard enabled, !user.id.isEmpty else { reset(); return }
        guard userID != user.id else { return }
        if !started {
            // Public, write-only project token, shared with Desktop.
            let config = PostHogConfig(
                projectToken: "phc_tD7X8fho5ug5BcC6zTZRWDn7wKFqGk3t3Y5bVE9Z67a9",
                host: "https://us.i.posthog.com"
            )
            config.captureApplicationLifecycleEvents = false
            config.captureScreenViews = false
            config.enableSwizzling = false
            config.preloadFeatureFlags = false
            #if os(iOS)
            config.surveys = false
            config.sessionReplay = false
            #endif
            PostHogSDK.shared.setup(config)
            // Discard a persisted SDK identity before attaching the verified session.
            PostHogSDK.shared.reset()
            started = true
        } else if userID != nil {
            reset()
        }
        userID = user.id
        #if os(iOS)
        let platform = "ios"
        #elseif os(macOS)
        let platform = "macos"
        #else
        let platform = "visionos"
        #endif
        PostHogSDK.shared.register(["platform": platform, "client": "nuphos-ios"])
        PostHogSDK.shared.identify(user.id)
        if active { foreground() }
    }

    func reset() {
        if started { PostHogSDK.shared.reset() }
        userID = nil
        currentScreen = nil
    }

    /// Root scene owns this signal. Restoring/login completion also emits an
    /// active event if the app is already foregrounded, after identify finishes.
    func setActive(_ value: Bool) {
        guard active != value else { return }
        active = value
        if value { foreground() }
        else if started { PostHogSDK.shared.flush() }
    }

    private func foreground() {
        track("app_active", teamID: currentScreen?.teamID)
        if let currentScreen { captureScreen(currentScreen.name, teamID: currentScreen.teamID) }
    }

    func screen(_ name: String, teamID: String? = nil) {
        guard enabled, userID != nil else { return }
        guard currentScreen?.name != name || currentScreen?.teamID != teamID else { return }
        currentScreen = (name, teamID)
        if active { captureScreen(name, teamID: teamID) }
    }

    private func captureScreen(_ name: String, teamID: String?) {
        guard enabled, userID != nil else { return }
        // Standard $screen feeds PostHog's existing pageview-or-screen DAU.
        PostHogSDK.shared.screen(name, properties: teamID.map { ["team_id": $0] })
    }

    /// Call sites pass only curated, non-content properties and explicit team
    /// context, so a delayed chat action cannot inherit another screen's team.
    func track(_ event: String, teamID: String? = nil, properties: [String: Any] = [:]) {
        guard enabled, userID != nil else { return }
        var properties = properties
        if let teamID { properties["team_id"] = teamID }
        PostHogSDK.shared.capture(event, properties: properties)
    }
}

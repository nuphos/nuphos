import Foundation
import PostHog

// Only the endpoint boundary is replaced; exercise the production wrapper.
@MainActor enum NuphosAPI {
    static let defaultBaseURL = URL(string: "https://api.nuphos.ai")!
    static var baseURL = defaultBaseURL
}

@main struct AnalyticsTests {
    @MainActor static func main() {
        let analytics = Analytics.shared
        let sdk = PostHogSDK.shared
        let alice = NuphosUser(id: "alice", email: "private@example.com", name: "Private", username: "private", avatarURL: "")
        let bob = NuphosUser(id: "bob", email: "", name: "", username: "", avatarURL: "")
        analytics.setActive(true)
        analytics.screen("agent")
        analytics.track("agent_message_sent")
        precondition(sdk.configs.isEmpty && sdk.events.isEmpty, "No anonymous or unvalidated-session events")

        NuphosAPI.baseURL = URL(string: "https://self-hosted.example.com")!
        analytics.identify(alice)
        analytics.screen("agent")
        precondition(sdk.configs.isEmpty && sdk.events.isEmpty, "Self-hosted must never start Cloud telemetry")
        NuphosAPI.baseURL = NuphosAPI.defaultBaseURL
        analytics.identify(alice)
        #if DEBUG
        analytics.screen("agent")
        analytics.track("login")
        precondition(sdk.configs.isEmpty && sdk.events.isEmpty, "Debug builds must stay offline")
        print("Analytics Debug isolation passed")
        #else
        precondition(sdk.configs.count == 1)
        let config = sdk.configs[0]
        precondition(!config.captureApplicationLifecycleEvents && !config.captureScreenViews && !config.enableSwizzling)
        precondition(!config.preloadFeatureFlags)
        precondition(sdk.events.map(\.name) == ["app_active"] && sdk.events.last?.user == "alice", "Identify before foreground event")
        analytics.identify(alice)
        analytics.setActive(true)
        precondition(sdk.events.count == 1, "Duplicate auth/scene notifications do not inflate activity")
        analytics.screen("agent", teamID: "team-a")
        analytics.screen("agent", teamID: "team-a")
        precondition(sdk.events.count == 2 && sdk.events.last?.name == "$screen")
        precondition(sdk.events.last?.properties["team_id"] as? String == "team-a")
        analytics.setActive(false)
        analytics.screen("chat", teamID: "team-b")
        precondition(sdk.events.count == 2, "No screenviews in background")
        analytics.setActive(true)
        precondition(sdk.events.suffix(2).map(\.name) == ["app_active", "$screen"], "Return emits a fresh screen for cross-day DAU")
        precondition(sdk.events.last?.properties["team_id"] as? String == "team-b")
        // SwiftUI navigation is checked separately on the simulator. Once its
        // root-content onAppear restores the list, neither foregrounding nor
        // reopening a chat in the same team may retain/deduplicate the old chat.
        for page in ["agent", "plans"] {
            analytics.screen(page, teamID: "team-b")
            analytics.screen("chat", teamID: "team-b")
            analytics.screen(page, teamID: "team-b")
            analytics.setActive(false)
            analytics.setActive(true)
            precondition(sdk.events.last?.properties["$screen_name"] as? String == page)
            let count = sdk.events.count
            analytics.screen("chat", teamID: "team-b")
            precondition(sdk.events.count == count + 1)
            precondition(sdk.events.last?.properties["$screen_name"] as? String == "chat")
        }
        analytics.track("agent_plan_approved", teamID: "team-a", properties: ["plan_id": "plan-1"])
        precondition(sdk.events.last?.properties["team_id"] as? String == "team-a", "Delayed operations retain their own team")
        precondition(sdk.events.last?.properties["client"] as? String == "nuphos-ios")
        precondition(sdk.events.allSatisfy { $0.properties["email"] == nil && $0.properties["name"] == nil })
        analytics.reset()
        let signedOutCount = sdk.events.count
        analytics.track("agent_message_sent", teamID: "team-a")
        analytics.screen("chat", teamID: "team-a")
        precondition(sdk.events.count == signedOutCount, "No post-logout attribution to old user")
        analytics.identify(bob)
        precondition(sdk.events.count == signedOutCount + 1 && sdk.events.last?.user == "bob")
        precondition(sdk.events.last?.properties["team_id"] == nil, "Old screen/team cleared on logout")
        analytics.identify(alice)
        precondition(sdk.events.last?.user == "alice" && sdk.resets >= 3, "Direct account switches reset identity")
        NuphosAPI.baseURL = URL(string: "https://self-hosted.example.com")!
        let cloudCount = sdk.events.count
        analytics.track("login")
        analytics.setActive(false)
        analytics.setActive(true)
        precondition(sdk.events.count == cloudCount, "Endpoint changes gate every capture")
        print("Analytics identity, foreground, screen, team and endpoint tests passed")
        #endif
    }
}

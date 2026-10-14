import Foundation

/// Recognises the app's own plan links — `https://nuphos.ai/teams/T/plans/N`
/// (any nuphos.ai host) or the bare path — the way the desktop's
/// `parseAtlasLink` does, so a tap opens the plan in-app instead of Safari.
enum PlanLink {
    struct Target: Equatable, Identifiable {
        let teamId: String
        let planId: String
        var id: String { teamId + "/" + planId }
    }

    static func target(in url: URL) -> Target? {
        // /teams/<teamId>/plans/<planId>
        guard let parts = SessionLink.appPath(of: url), parts.count >= 4, parts[0] == "teams", parts[2] == "plans", !parts[1].isEmpty, !parts[3].isEmpty else { return nil }
        return Target(teamId: parts[1], planId: parts[3])
    }
}

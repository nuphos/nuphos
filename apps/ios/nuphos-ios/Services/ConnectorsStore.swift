import Foundation
import Observation

/// The Connectors page's state: the team's bound connectors, and the connect
/// flows that add to them. One per signed-in session; the team it reads is
/// whatever `AgentStore` has selected.
@MainActor
@Observable
final class ConnectorsStore {
    enum Phase: Equatable {
        case idle, loading, loaded, failed(String)
    }

    private(set) var inventory: ConnectorInventory?
    private(set) var phase: Phase = .idle
    /// The connector a connect flow is currently running for.
    private(set) var connecting: String?
    /// Last connect failure, surfaced as an alert. Cancellation is not an error.
    var connectError: String?

    private let token: String
    private var loadedTeamId: String?

    init(token: String) {
        self.token = token
    }

    func load(teamId: String, force: Bool = false) async {
        guard force || loadedTeamId != teamId || inventory == nil else { return }
        if inventory == nil || loadedTeamId != teamId { phase = .loading }
        do {
            inventory = try await ConnectorsAPI.inventory(token: token, teamId: teamId)
            loadedTeamId = teamId
            phase = .loaded
        } catch {
            phase = .failed(error.localizedDescription)
        }
    }

    /// Runs `connector`'s connect flow end to end and refreshes the inventory.
    /// Returns true when something was actually bound.
    @discardableResult
    func connect(_ connector: Connector, teamId: String, fields: [String: String] = [:]) async -> Bool {
        guard connecting == nil else { return false }
        connecting = connector.key
        defer { connecting = nil }

        do {
            switch connector.bind {
            case .oauth(let path, let callbackHost):
                try await runOAuth(path: path, callbackHost: callbackHost, teamId: teamId)
            case .githubApp:
                try await runGithubInstall(teamId: teamId)
            case .form(let path, _):
                try await ConnectorsAPI.bind(token: token, teamId: teamId, path: path, body: fields)
            case .desktopOnly:
                return false
            }
        } catch ConnectorOAuth.Failure.cancelled {
            return false
        } catch {
            connectError = error.localizedDescription
            return false
        }

        await load(teamId: teamId, force: true)
        return true
    }

    private func runOAuth(path: String, callbackHost: String, teamId: String) async throws {
        let pending = try await ConnectorsAPI.startOAuth(token: token, teamId: teamId, path: path)
        do {
            let query = try await ConnectorOAuth().run(url: pending.authorizeUrl, expectedHost: callbackHost)
            // A redirect carrying someone else's state is not a completion of
            // *this* flow — don't report it as one.
            guard query["state"] == pending.state else {
                throw ConnectorOAuth.Failure.provider("The provider came back with a mismatched request. Please try again.")
            }
            // A backend that stages grants sends a one-time code instead of
            // binding; confirming it is what creates the binding.
            if query["deferred"] == "1" {
                guard let code = query["code"], !code.isEmpty else {
                    throw ConnectorOAuth.Failure.provider("The provider came back without a confirmation code. Please try again.")
                }
                try await ConnectorsAPI.completeOAuth(token: token, teamId: teamId, state: pending.state, code: code)
            }
        } catch {
            // Tear the grant down server-side so the authorize URL left open
            // in the browser can't complete into a binding nobody asked for.
            await ConnectorsAPI.cancelOAuth(token: token, teamId: teamId, path: path, state: pending.state)
            throw error
        }
    }

    /// GitHub hands the installation back through the redirect rather than
    /// binding server-side, so the app records it in a second call — which
    /// means the app, not the backend, has to prove the redirect belongs to
    /// the install it started. Mirrors the desktop's `handleCallback`:
    /// correlate on a per-flow `state`, then check the action and the id.
    private func runGithubInstall(teamId: String) async throws {
        let issued = try await ConnectorsAPI.githubInstallURL(token: token, teamId: teamId)
        let state = Self.freshState()

        guard var components = URLComponents(url: issued, resolvingAgainstBaseURL: false) else {
            throw ConnectorOAuth.Failure.provider("Could not build the GitHub install URL.")
        }
        var items = components.queryItems?.filter { $0.name != "state" } ?? []
        items.append(URLQueryItem(name: "state", value: state))
        components.queryItems = items
        guard let url = components.url else {
            throw ConnectorOAuth.Failure.provider("Could not build the GitHub install URL.")
        }

        let query = try await ConnectorOAuth().run(url: url, expectedHost: "github-callback")

        guard query["state"] == state else {
            throw ConnectorOAuth.Failure.provider("GitHub came back with a mismatched request. Please try again.")
        }
        let action = query["setup_action"] ?? "install"
        guard action == "install" || action == "update" else {
            throw ConnectorOAuth.Failure.provider("Unexpected GitHub setup action: \(action).")
        }
        guard let raw = query["installation_id"],
              raw.allSatisfy(\.isASCII), raw.allSatisfy(\.isNumber),
              let installationId = Int(raw), installationId > 0
        else {
            throw ConnectorOAuth.Failure.provider("GitHub did not return an installation.")
        }
        try await ConnectorsAPI.bindGithubInstallation(token: token, teamId: teamId, installationId: installationId)
    }

    /// 16 random bytes, hex — the same shape the desktop's install uses.
    /// `UInt8.random` draws from `SystemRandomNumberGenerator`, the platform
    /// CSPRNG, which is what an unguessable correlation token needs.
    private static func freshState() -> String {
        (0..<16).map { _ in String(format: "%02x", UInt8.random(in: .min ... .max)) }.joined()
    }
}

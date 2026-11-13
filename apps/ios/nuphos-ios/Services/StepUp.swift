import Foundation
import Observation

/// Step-up re-authentication. With two-factor authentication on, some actions
/// answer `403 reauth_required` unless a code was entered in the last few
/// minutes. Every request helper runs through `retrying`: such a failure asks
/// for a code (the sheet `RootView` shows for `StepUpPrompt`), confirms it with
/// `POST /auth/mfa/reauth`, and sends the request once more.
enum StepUp {
    nonisolated(nonsending) static func retrying<T>(token: String?, _ send: () async throws -> T) async throws -> T {
        do {
            return try await send()
        } catch NuphosAPI.Failure.reauthRequired {
            guard let token, await StepUpPrompt.shared.confirm(token: token) else {
                throw NuphosAPI.Failure.reauthRequired
            }
            return try await send()
        }
    }
}

/// The one code prompt for every request that needs it; requests that need it
/// together wait on the same answer.
@MainActor @Observable
final class StepUpPrompt {
    static let shared = StepUpPrompt()

    /// The account asking; set while the sheet is up.
    private(set) var token: String?
    /// Shows the sheet over whatever is on screen; set by `RootView`. Without
    /// it (the share extension) nothing asks.
    var present: (@MainActor (StepUpPrompt) -> Void)?
    private var waiting: [CheckedContinuation<Bool, Never>] = []

    func confirm(token: String) async -> Bool {
        guard let present else { return false }
        return await withCheckedContinuation { continuation in
            waiting.append(continuation)
            if self.token == nil {
                self.token = token
                present(self)
            }
        }
    }

    /// Sends the code; throws when it is refused, which keeps the sheet up.
    func submit(code: String) async throws {
        guard let token else { return }
        struct Empty: Decodable {}
        let _: Empty = try await AccountAPI.request("mfa/reauth", method: "POST", token: token, body: ["code": code])
        finish(true)
    }

    /// Answers with a passkey instead of a code.
    func submitPasskey() async throws {
        guard let token else { return }
        let answer = try await Passkeys.answer(try await AccountAPI.sessionPasskeyOptions(token: token))
        struct Empty: Decodable {}
        let _: Empty = try await AccountAPI.request("mfa/reauth", method: "POST", token: token, body: ["passkey": answer])
        finish(true)
    }

    func cancel() { finish(false) }

    private func finish(_ ok: Bool) {
        token = nil
        let continuations = waiting
        waiting = []
        continuations.forEach { $0.resume(returning: ok) }
    }
}

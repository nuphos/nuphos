import AuthenticationServices
import Foundation
#if canImport(UIKit)
import UIKit
#endif

/// Passkeys as a second factor (#1054): the platform ceremony around the
/// backend's options, turned into the WebAuthn JSON the backend verifies. The
/// passkey belongs to the backend's RP ID (nuphos.ai), which this app may use
/// through the `webcredentials` associated domain.
enum Passkeys {
    struct Credential: Decodable { let id: String }
    struct AssertionOptions: Decodable {
        let challenge: String
        let rpId: String?
        let allowCredentials: [Credential]?
    }
    struct RegistrationOptions: Decodable {
        struct RP: Decodable { let id: String? }
        struct User: Decodable { let id: String; let name: String }
        let challenge: String
        let rp: RP
        let user: User
    }

    static let defaultRP = "nuphos.ai"

    /// A passkey's answer to `options`, as `AuthenticationResponseJSON`.
    @MainActor
    static func answer(_ options: AssertionOptions) async throws -> [String: Any] {
        let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: options.rpId ?? defaultRP)
        let request = provider.createCredentialAssertionRequest(challenge: try decode(options.challenge))
        request.allowedCredentials = try (options.allowCredentials ?? []).map {
            ASAuthorizationPlatformPublicKeyCredentialDescriptor(credentialID: try decode($0.id))
        }
        guard let credential = try await Ceremony().run(request) as? ASAuthorizationPlatformPublicKeyCredentialAssertion else {
            throw Failure.cancelled
        }
        let id = encode(credential.credentialID)
        var response: [String: Any] = [
            "clientDataJSON": encode(credential.rawClientDataJSON),
            "authenticatorData": encode(credential.rawAuthenticatorData),
            "signature": encode(credential.signature),
        ]
        if !credential.userID.isEmpty { response["userHandle"] = encode(credential.userID) }
        return ["id": id, "rawId": id, "type": "public-key", "response": response, "clientExtensionResults": [String: Any]()]
    }

    /// A new passkey for `options`, as `RegistrationResponseJSON`.
    @MainActor
    static func create(_ options: RegistrationOptions) async throws -> [String: Any] {
        let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: options.rp.id ?? defaultRP)
        let request = provider.createCredentialRegistrationRequest(
            challenge: try decode(options.challenge), name: options.user.name, userID: try decode(options.user.id)
        )
        guard let credential = try await Ceremony().run(request) as? ASAuthorizationPlatformPublicKeyCredentialRegistration,
              let attestation = credential.rawAttestationObject else {
            throw Failure.cancelled
        }
        let id = encode(credential.credentialID)
        return [
            "id": id, "rawId": id, "type": "public-key",
            "response": [
                "clientDataJSON": encode(credential.rawClientDataJSON),
                "attestationObject": encode(attestation),
                "transports": ["internal", "hybrid"],
            ],
            "clientExtensionResults": [String: Any](),
        ]
    }

    enum Failure: LocalizedError {
        case cancelled, malformed
        var errorDescription: String? {
            switch self {
            case .cancelled: "The passkey request was cancelled."
            case .malformed: "Nuphos sent passkey options this app could not read."
            }
        }
    }

    private static func decode(_ base64url: String) throws -> Data {
        var text = base64url.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        text += String(repeating: "=", count: (4 - text.count % 4) % 4)
        guard let data = Data(base64Encoded: text) else { throw Failure.malformed }
        return data
    }

    private static func encode(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

/// One `ASAuthorizationController` run, as an async call.
@MainActor
private final class Ceremony: NSObject, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    private var continuation: CheckedContinuation<ASAuthorizationCredential, Error>?
    /// Held until the request finishes; the controller does not keep itself.
    private var controller: ASAuthorizationController?

    func run(_ request: ASAuthorizationRequest) async throws -> ASAuthorizationCredential {
        try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            let controller = ASAuthorizationController(authorizationRequests: [request])
            controller.delegate = self
            controller.presentationContextProvider = self
            self.controller = controller
            controller.performRequests()
        }
    }

    nonisolated func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        MainActor.assumeIsolated { finish(.success(authorization.credential)) }
    }

    nonisolated func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        // Dismissing the sheet is not an error worth showing.
        let cancelled = (error as? ASAuthorizationError)?.code == .canceled
        MainActor.assumeIsolated { finish(.failure(cancelled ? Passkeys.Failure.cancelled : error)) }
    }

    nonisolated func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        MainActor.assumeIsolated {
            #if canImport(UIKit) && !NUPHOS_SHARE_EXTENSION
            let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
                .first { $0.activationState == .foregroundActive }
            return scene?.keyWindow ?? ASPresentationAnchor()
            #else
            return ASPresentationAnchor()
            #endif
        }
    }

    private func finish(_ result: Result<ASAuthorizationCredential, Error>) {
        continuation?.resume(with: result)
        continuation = nil
        controller = nil
    }
}

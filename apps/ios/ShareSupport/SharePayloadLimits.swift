import Foundation

enum SharePayloadLimits {
    static let maxFiles = 10
    static let maxFileBytes = 20 * 1024 * 1024
    static let maxTextBytes = 256 * 1024
    enum Failure: LocalizedError {
        case unavailable, invalidFile, capacity
        var errorDescription: String? {
            switch self {
            case .unavailable: return "Open Nuphos and sign in. Shared Keychain provisioning is required before real sending is available."
            case .invalidFile: return "This shared content cannot be imported. Nothing was sent."
            case .capacity: return "Share up to 10 attachments, 20 MB each, and 256 KB of text."
            }
        }
    }
}

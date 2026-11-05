import Foundation

/// Recheck identity and cancellation after an asynchronous upload, including
/// transports that return successfully after their task has been cancelled.
@MainActor
enum SubmissionAdmission {
    static func prepare<T>(check: (() throws -> Void)?, operation: () async throws -> T) async throws -> T {
        try Task.checkCancellation()
        try check?()
        let result = try await operation()
        try Task.checkCancellation()
        try check?()
        return result
    }
}

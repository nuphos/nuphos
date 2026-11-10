import Foundation

/// A proposed plan asks its owner to decide it, as a question does. Answering
/// that question approves or rejects the plan before the answer's turn runs, so
/// the answer itself wakes the agent, from the plan card or the Plans tab alike.
enum PlanAnswer {
    static let approve = "Approve"
    static let reject = "Reject"

    /// Answers the plan's open question with `choice`. False when the plan has
    /// none (one proposed before plans asked), so the caller decides it directly.
    static func send(_ choice: String, planId: String, sessionId: String?, token: String, teamId: String) async throws -> Bool {
        guard let sessionId else { return false }
        let detail = try await NuphosAPI.conversationDetail(token: token, teamId: teamId, sessionId: sessionId, tail: 1)
        guard let question = detail.inputRequests.first(where: { $0.planId == planId }) else { return false }
        try await AgentChatAPI.reply(token: token, teamId: teamId, sessionId: sessionId, text: choice,
                                     decisionReplyTo: question.id)
        return true
    }
}

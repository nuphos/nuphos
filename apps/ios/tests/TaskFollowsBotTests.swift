import Foundation

enum TaskFollowsBotTests {
    static func run() {
        aTaskUnderABotFollowsIt()
        aConversationWithoutASourceKeepsItsOwnControls()
        print("Task follows Bot passed")
    }

    private static func detail(_ json: String) -> AgentConversationDetail {
        try! JSONDecoder().decode(AgentConversationDetail.self, from: Data(json.utf8))
    }

    // The backend sends credentialSource only for a Task whose credentials, computers and mode are its Bot's.
    private static func aTaskUnderABotFollowsIt() {
        precondition(detail(#"{"agentRuntime":"claude-code","credentialSource":{"sessionId":"bot"}}"#).followsBot)
    }

    private static func aConversationWithoutASourceKeepsItsOwnControls() {
        precondition(!detail(#"{"agentRuntime":"claude-code"}"#).followsBot)
    }
}

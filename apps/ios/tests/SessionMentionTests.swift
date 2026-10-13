import Foundation

enum SessionMentionTests {
    static func run() {
        startsAtALineStartOrAfterWhitespace()
        replacesTheQueryWithTheLink()
        print("Session mention passed")
    }

    private static func startsAtALineStartOrAfterWhitespace() {
        precondition(SessionMention.query(in: "@") == "")
        precondition(SessionMention.query(in: "see @dep") == "dep")
        precondition(SessionMention.query(in: "line\n@bo") == "bo")
        precondition(SessionMention.query(in: "mail me at a@b") == nil)
        precondition(SessionMention.query(in: "@deploy done") == nil)
        precondition(SessionMention.query(in: "no mention") == nil)
    }

    private static func replacesTheQueryWithTheLink() {
        let link = URL(string: "https://nuphos.ai/teams/t1/agent/s1")!
        precondition(SessionMention.insert(link, into: "compare with @dep") == "compare with https://nuphos.ai/teams/t1/agent/s1 ")
        precondition(SessionMention.insert(link, into: "@") == "https://nuphos.ai/teams/t1/agent/s1 ")
    }
}

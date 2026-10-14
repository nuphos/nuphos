import Foundation

enum SessionMentionTests {
    static func run() {
        startsAtALineStartOrAfterWhitespace()
        replacesTheQueryWithTheLink()
        matchesDeviceLabels()
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
        let link = "https://nuphos.ai/teams/t1/agent/s1"
        precondition(SessionMention.insert(link, into: "compare with @dep") == "compare with https://nuphos.ai/teams/t1/agent/s1 ")
        precondition(SessionMention.insert("@Ann's Mac", into: "run on @ann") == "run on @Ann's Mac ")
    }

    private static func matchesDeviceLabels() {
        precondition(SessionMention.matches("Ann's MacBook Pro", "macbook"))
        precondition(SessionMention.matches("build-box", ""))
        precondition(!SessionMention.matches("build-box", "mac"))
    }
}

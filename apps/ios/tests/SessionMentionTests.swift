import Foundation

enum SessionMentionTests {
    static func run() {
        startsAtALineStartOrAfterWhitespace()
        replacesTheQueryWithTheLink()
        matchesDeviceLabels()
        sendsPickedNamesAsLinks()
        showsKnownLinksByName()
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

    private static func sendsPickedNamesAsLinks() {
        let link = URL(string: "https://nuphos.ai/teams/t1/agent/s1")!
        let wider = URL(string: "https://nuphos.ai/teams/t1/agent/s2")!
        precondition(SessionMention.expand("ask @Notes and @Notes v2 ", links: ["@Notes": link, "@Notes v2": wider])
            == "ask https://nuphos.ai/teams/t1/agent/s1 and https://nuphos.ai/teams/t1/agent/s2 ")
        precondition(SessionMention.expand("no picks", links: [:]) == "no picks")
    }

    private static func showsKnownLinksByName() {
        let team = "0123456789abcdef01234567"
        let link = "https://nuphos.ai/teams/\(team)/agent/bot-a"
        let titles = ["bot-a": "Sign-in [beta]"]
        precondition(SessionMention.named("Ask \(link) now", title: { titles[$0] })
            == "Ask [@Sign-in \\[beta\\]](\(link)) now")
        precondition(SessionMention.named("\(link)", title: { titles[$0] }) == "[@Sign-in \\[beta\\]](\(link))")
        // Unknown conversations and links already written as markdown keep their text.
        precondition(SessionMention.named("see https://nuphos.ai/teams/\(team)/agent/other", title: { titles[$0] })
            == "see https://nuphos.ai/teams/\(team)/agent/other")
        precondition(SessionMention.named("[here](\(link))", title: { titles[$0] }) == "[here](\(link))")
    }
}

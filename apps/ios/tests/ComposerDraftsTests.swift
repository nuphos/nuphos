import Foundation

enum ComposerDraftsTests {
    static func run() {
        isolatesLateWritesFromAnotherAccount()
        restoresEachConversationsDraft()
        textTypedBeforeTheTeamResolvesSurvives()
        switchingBetweenTeamsSwapsDrafts()
        signOutDropsEverything()
        print("Composer drafts passed")
    }

    private static func isolatesLateWritesFromAnotherAccount() {
        ComposerDrafts.clear()
        ComposerDrafts.set("late old account draft", team: "shared-team", session: "shared-session", identity: "old-synthetic-token")
        precondition(ComposerDrafts.text(team: "shared-team", session: "shared-session", identity: "new-synthetic-token").isEmpty)
        precondition(ComposerDrafts.text(team: "shared-team", session: "shared-session", identity: "old-synthetic-token") == "late old account draft")
    }

    private static func restoresEachConversationsDraft() {
        ComposerDrafts.clear()
        ComposerDrafts.set("half written", team: "t1", session: "a")
        ComposerDrafts.set("other", team: "t1", session: "b")
        precondition(ComposerDrafts.text(team: "t1", session: "a") == "half written")
        ComposerDrafts.set("  ", team: "t1", session: "a")
        precondition(ComposerDrafts.text(team: "t1", session: "a").isEmpty, "a sent message must not come back")
    }

    private static func textTypedBeforeTheTeamResolvesSurvives() {
        ComposerDrafts.clear()
        ComposerDrafts.set("typed during launch", team: "", session: "new")
        let shown = ComposerDrafts.switchTeam(visible: "typed during launch", session: "new", from: "", to: "t1")
        precondition(shown == "typed during launch", "got \(shown)")
        precondition(ComposerDrafts.text(team: "t1", session: "new") == "typed during launch")
        precondition(ComposerDrafts.text(team: "", session: "new").isEmpty)
    }

    private static func switchingBetweenTeamsSwapsDrafts() {
        ComposerDrafts.clear()
        ComposerDrafts.set("for one", team: "t1", session: "new")
        ComposerDrafts.set("for two", team: "t2", session: "new")
        precondition(ComposerDrafts.switchTeam(visible: "for one", session: "new", from: "t1", to: "t2") == "for two")
        precondition(ComposerDrafts.switchTeam(visible: "", session: "new", from: "", to: "t1") == "for one")
    }

    private static func signOutDropsEverything() {
        ComposerDrafts.set("private", team: "t1", session: "a")
        ComposerDrafts.clear()
        precondition(ComposerDrafts.text(team: "t1", session: "a").isEmpty)
    }
}

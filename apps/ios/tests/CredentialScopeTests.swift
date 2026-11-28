import Foundation

enum CredentialScopeTests {
    static func run() {
        aStoredSelectionSendsOnlyItsKinds()
        // The member's own GitHub is a credential like any other, its id the provider the server answers asks by.
        let personal = CredentialCatalog(json: JSONValue.parse(#"{"personalCredentials":[{"provider":"github","login":"octocat"}]}"#)!)
        precondition(personal.allItems.map(\.id) == ["github"])
        precondition(personal.allItems.first?.label == "octocat")
        var own = CredentialSelection()
        own.toggle(personal.allItems[0])
        precondition(own.json["personalCredentialIds"]?.arrayValue?.compactMap(\.stringValue) == ["github"])
        // With the team's GitHub already selected, opting into one's own adds personalCredentialIds
        // and leaves the installation and teamIdentity as stored.
        var stored = CredentialSelection(json: JSONValue.parse(#"{"githubInstallationIds":["166"],"teamIdentity":["linear"]}"#)!)
        stored.toggle(personal.allItems[0])
        precondition(stored.json["githubInstallationIds"]?.arrayValue?.compactMap(\.stringValue) == ["166"])
        precondition(stored.json["personalCredentialIds"]?.arrayValue?.compactMap(\.stringValue) == ["github"])
        precondition(stored.json["teamIdentity"]?.arrayValue?.compactMap(\.stringValue) == ["linear"])
        // A new chat's defaults tick it, as the desktop's do, so the server does not refuse it (#4028).
        var personalDefaults = CredentialSelection()
        personalDefaults.selectDefaults(in: personal)
        precondition(personalDefaults.json["personalCredentialIds"]?.arrayValue?.compactMap(\.stringValue) == ["github"])
        var personalAll = CredentialSelection()
        personalAll.selectAll(in: personal)
        precondition(personalAll.containsAll(in: personal))
        precondition(personalAll.json["personalCredentialIds"]?.arrayValue?.compactMap(\.stringValue) == ["github"])
        // An integration question's picker offers only what answers it: its providers' kinds and the member's own of that name.
        let team = CredentialCatalog(json: JSONValue.parse(#"{"awsRoles":[{"roleId":"aws","accountId":"1"}],"gcpServiceAccounts":[{"serviceAccountId":"gcp","projectId":"p"}],"githubInstallations":[{"installationId":"166","accountLogin":"o"}],"personalCredentials":[{"provider":"github","login":"octocat"},{"provider":"linear","login":"me"}]}"#)!)
        precondition(team.answering(["gcp"]).allItems.map(\.id) == ["gcp"])
        precondition(Set(team.answering(["github"]).allItems.map(\.id)) == ["github", "166"])
        precondition(team.answering(["play-console"]).isEmpty)
        precondition(team.answering(nil).allItems.count == 5)
        var gcp = CredentialSelection()
        gcp.selectAll(in: team.answering(["gcp"]))
        precondition(gcp.json["gcpServiceAccountIds"]?.arrayValue?.compactMap(\.stringValue) == ["gcp"] && gcp.count == 1)
        let catalog = CredentialCatalog(json: JSONValue.parse(#"{"devices":[{"deviceId":"mac","label":"Mac","platform":"darwin"}],"awsRoles":[{"roleId":"aws","accountId":"123"}]}"#)!)
        let iam = catalog.scoped(to: .credentials)
        let devices = catalog.scoped(to: .devices)
        precondition(iam.allItems.map(\.id) == ["aws"])
        precondition(devices.allItems.map(\.id) == ["mac"])
        precondition(devices.allItems.first?.detail == "macOS")
        var selection = CredentialSelection(json: JSONValue.parse(#"{"deviceIds":["mac","offline"],"futureIds":["future"]}"#)!)
        precondition(selection.count(in: .credentials) == 0)
        precondition(selection.count(in: .devices) == 2)
        selection.selectAll(in: iam)
        precondition(selection.containsAll(in: iam))
        precondition(selection.count(in: .devices) == 2)
        selection.clearAll(scope: .credentials)
        precondition(selection.count(in: .credentials) == 0)
        precondition(selection.count(in: .devices) == 2)
        precondition(selection.json["futureIds"]?.arrayValue?.isEmpty == true)
        selection.selectAll(in: iam)
        selection.clearAll(scope: .devices)
        precondition(selection.containsAll(in: iam))
        precondition(selection.count(in: .devices) == 0)
        selection.selectAll(in: devices)
        let restored = CredentialSelection(json: selection.json)
        precondition(restored.containsAll(in: iam) && restored.containsAll(in: devices))
        selection.clearAll()
        precondition(selection.isEmpty)
        let devicesOnly = CredentialCatalog(json: JSONValue.parse(#"{"devices":[{"deviceId":"mac","label":"Mac"}]}"#)!)
        precondition(devicesOnly.scoped(to: .credentials).isEmpty)
        precondition(!devicesOnly.scoped(to: .devices).isEmpty)
        let mixed = CredentialCatalog(json: JSONValue.parse(#"{"devices":[{"deviceId":"m1","label":"M1","platform":"darwin","available":true},{"deviceId":"m5","label":"M5","platform":"darwin","available":false}]}"#)!).scoped(to: .devices)
        precondition(mixed.allItems.map(\.detail) == ["macOS", "macOS · Unavailable"])
        var picked = CredentialSelection()
        picked.selectAll(in: mixed)
        precondition(picked.json["deviceIds"]?.arrayValue?.compactMap(\.stringValue) == ["m1"])
        precondition(picked.containsAll(in: mixed))
        let withResend = CredentialCatalog(json: JSONValue.parse(#"{"devices":[{"deviceId":"m1","label":"M1","available":true},{"deviceId":"m5","label":"M5","available":false}],"awsRoles":[{"roleId":"aws","accountId":"123"}],"resendIntegrations":[{"integrationId":"mail","label":"Mail"}]}"#)!)
        var defaults = CredentialSelection()
        defaults.selectDefaults(in: withResend)
        precondition(defaults.ids["awsRoleIds"] == ["aws"] && defaults.ids["deviceIds"] == ["m1"])
        defaultsAreAll()
        narrowingTurnsAllOff()
        draftWaitsForTheCatalog(withResend)
        draftDropsStaleResults(withResend)
        print("Credential scope tests passed")
    }

    /// A new chat starts on All, as the desktop's `defaultCredentialAccess` (#4940): both flags on the
    /// wire and every usable one ticked, Resend and Trello included.
    private static func defaultsAreAll() {
        let catalog = CredentialCatalog(json: JSONValue.parse(#"{"devices":[{"deviceId":"m1","label":"M1","available":true}],"awsRoles":[{"roleId":"aws","accountId":"123"}],"resendIntegrations":[{"integrationId":"mail","label":"Mail"}],"trelloIntegrations":[{"integrationId":"board","label":"Board"}]}"#)!)
        var defaults = CredentialSelection()
        defaults.selectDefaults(in: catalog)
        let wire = defaults.json
        precondition(wire["allCredentials"] == .bool(true), "default allCredentials: \(String(describing: wire["allCredentials"]))")
        precondition(wire["allDevices"] == .bool(true), "default allDevices: \(String(describing: wire["allDevices"]))")
        precondition(wire["resendIntegrationIds"]?.arrayValue?.compactMap(\.stringValue) == ["mail"],
                     "default resendIntegrationIds: \(String(describing: wire["resendIntegrationIds"]))")
        precondition(wire["trelloIntegrationIds"]?.arrayValue?.compactMap(\.stringValue) == ["board"],
                     "default trelloIntegrationIds: \(String(describing: wire["trelloIntegrationIds"]))")
        precondition(wire["awsRoleIds"]?.arrayValue?.compactMap(\.stringValue) == ["aws"])
        precondition(wire["deviceIds"]?.arrayValue?.compactMap(\.stringValue) == ["m1"])
        // A team with nothing connected yet still starts on All, so a credential added later is in.
        var empty = CredentialSelection()
        empty.selectDefaults(in: CredentialCatalog(json: .object([:])))
        precondition(!empty.isBlank, "an empty team's default is still All")
    }

    /// Unticking a row or Clear all turns that scope's All off, so the server stores the narrowed list
    /// instead of filling it back in; ticking one keeps All. A stored All reads back as All.
    private static func narrowingTurnsAllOff() {
        let catalog = CredentialCatalog(json: JSONValue.parse(#"{"devices":[{"deviceId":"m1","label":"M1","available":true}],"awsRoles":[{"roleId":"aws","accountId":"123"},{"roleId":"later","accountId":"456"}]}"#)!)
        let aws = catalog.allItems.first { $0.id == "aws" }!
        let later = catalog.allItems.first { $0.id == "later" }!
        let mac = catalog.allItems.first { $0.id == "m1" }!
        let stored = CredentialSelection(json: JSONValue.parse(#"{"awsRoleIds":["aws"],"deviceIds":["m1"],"allCredentials":true,"allDevices":true}"#)!)
        precondition(stored.json["allCredentials"] == .bool(true) && stored.json["allDevices"] == .bool(true), "a stored All is sent back as All")
        var added = stored
        added.toggle(later)
        precondition(added.json["allCredentials"] == .bool(true), "ticking one keeps All")
        var narrowed = stored
        narrowed.toggle(aws)
        precondition(narrowed.json["allCredentials"] == nil,
                     "unticking a credential turns allCredentials off: \(String(describing: narrowed.json["allCredentials"]))")
        precondition(narrowed.json["allDevices"] == .bool(true), "unticking a credential keeps allDevices")
        var noComputer = stored
        noComputer.toggle(mac)
        precondition(noComputer.json["allDevices"] == nil, "unticking a computer turns allDevices off")
        precondition(noComputer.json["allCredentials"] == .bool(true), "unticking a computer keeps allCredentials")
        var cleared = stored
        cleared.clearAll(scope: .devices)
        precondition(cleared.json["allDevices"] == nil && cleared.json["allCredentials"] == .bool(true))
        cleared.clearAll(scope: .credentials)
        precondition(cleared.json["allCredentials"] == nil)
        var none = stored
        none.clearAll()
        precondition(none.json["allCredentials"] == nil && none.json["allDevices"] == nil)
    }

    private struct LoadFailed: Error {}

    /// Nothing is ready until the first load lands; it then applies the
    /// defaults, and a later refresh keeps a deliberate empty choice.
    private static func draftWaitsForTheCatalog(_ catalog: CredentialCatalog) {
        var draft = CredentialDraft()
        let load = draft.begin()
        precondition(!draft.isReady && draft.selection.isEmpty)
        draft.finish(load, with: .success(catalog))
        precondition(draft.isReady && draft.selection.ids["awsRoleIds"] == ["aws"])
        draft.selection.clearAll()
        draft.finish(draft.begin(), with: .success(catalog))
        precondition(draft.selection.isEmpty, "A refresh must not re-tick what the user cleared")

        var failed = CredentialDraft()
        failed.finish(failed.begin(), with: .failure(LoadFailed()))
        precondition(failed.isReady && failed.catalog == nil && failed.error != nil)
    }

    /// Out-of-order completions and team switches (A -> B -> A) drop the older result.
    private static func draftDropsStaleResults(_ catalog: CredentialCatalog) {
        let other = CredentialCatalog(json: JSONValue.parse(#"{"awsRoles":[{"roleId":"other","accountId":"9"}]}"#)!)
        var draft = CredentialDraft()
        let older = draft.begin()
        let newer = draft.begin()
        draft.finish(newer, with: .success(catalog))
        draft.finish(older, with: .success(other))
        draft.finish(older, with: .failure(LoadFailed()))
        precondition(draft.catalog == catalog && draft.error == nil)

        var team = CredentialDraft()
        let teamA = team.begin()
        team.reset()
        let teamB = team.begin()
        team.reset()
        let teamAAgain = team.begin()
        team.finish(teamA, with: .success(other))
        team.finish(teamB, with: .success(other))
        precondition(!team.isReady, "Results for an earlier team must not fill this one")
        team.finish(teamAAgain, with: .success(catalog))
        precondition(team.selection.ids["awsRoleIds"] == ["aws"])
    }

    private static func aStoredSelectionSendsOnlyItsKinds() {
        let personal = CredentialCatalog(json: JSONValue.parse(#"{"personalCredentials":[{"provider":"github","login":"octocat"}]}"#)!)
        // No GitHub key: every installation. [] is none, null is unset, a string is malformed.
        var stored = CredentialSelection(json: JSONValue.parse(
            #"{"awsRoleIds":["aws"],"gitlabBindingIds":[],"notionIntegrationIds":null,"grafanaInstanceIds":"bogus"}"#)!)
        stored.toggle(personal.allItems[0])
        let sent = stored.json.objectValue ?? [:]
        // An unset kind stays unset rather than revoked as []; the empty one stays empty.
        precondition(Set(sent.keys) == ["awsRoleIds", "gitlabBindingIds", "grafanaInstanceIds", "personalCredentialIds"])
        precondition(sent["gitlabBindingIds"]?.arrayValue?.isEmpty == true)
        // Malformed fails closed: sent as none, never left out to mean "all".
        precondition(sent["grafanaInstanceIds"]?.arrayValue?.isEmpty == true)
        // Nothing stored is still stored: only what changed is sent.
        var none = CredentialSelection(json: .object([:]))
        none.toggle(personal.allItems[0])
        precondition(Set((none.json.objectValue ?? [:]).keys) == ["personalCredentialIds"])
        // A new conversation still states every kind.
        precondition(CredentialSelection().json.objectValue?["githubInstallationIds"]?.arrayValue?.isEmpty == true)
        anUnsetTeamWideKindIsShownInFull()
    }

    /// What `nuphos_ask` stores leaves GitHub unset, which the server reads as every installation (#4034).
    private static func anUnsetTeamWideKindIsShownInFull() {
        let team = CredentialCatalog(json: JSONValue.parse(
            #"{"awsRoles":[{"roleId":"aws","accountId":"1"},{"roleId":"aws2","accountId":"2"}],"githubInstallations":[{"installationId":"166","accountLogin":"o"},{"installationId":"177","accountLogin":"p"}]}"#)!)
        let github = team.allItems.filter { $0.provider.selectionKey == "githubInstallationIds" }
        let aws2 = team.allItems.first { $0.id == "aws2" }!
        let asked = CredentialSelection(json: JSONValue.parse(#"{"awsRoleIds":["aws"]}"#)!)
        var shown = asked.reaching(team)
        precondition(github.allSatisfy(shown.contains), "An unset GitHub key reaches every installation")
        precondition(!shown.contains(aws2), "Other kinds show only what is stored")
        precondition(asked.reaching(nil) == asked, "Nothing to fill before the catalog loads")
        // Unticking one installation stores the rest as a list.
        shown.toggle(github[0])
        precondition(shown.json["githubInstallationIds"]?.arrayValue?.compactMap(\.stringValue) == ["177"])
        // An explicit empty list is none, and a new conversation keeps its own defaults.
        let none = CredentialSelection(json: JSONValue.parse(#"{"githubInstallationIds":[]}"#)!)
        precondition(!github.contains(where: none.reaching(team).contains))
        precondition(CredentialSelection().reaching(team) == CredentialSelection())
    }
}

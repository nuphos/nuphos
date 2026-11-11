import Foundation

enum CredentialScopeTests {
    static func run() {
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
        // Never picked for the member by "Select all" or a new chat's defaults.
        var personalDefaults = CredentialSelection()
        personalDefaults.selectDefaults(in: personal)
        precondition(personalDefaults.count == 0)
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
        precondition(defaults.ids["resendIntegrationIds"]?.isEmpty == true, "Resend stays opt-in")
        draftWaitsForTheCatalog(withResend)
        draftDropsStaleResults(withResend)
        print("Credential scope tests passed")
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
}


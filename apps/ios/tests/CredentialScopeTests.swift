import Foundation

enum CredentialScopeTests {
    static func run() {
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


import Foundation

enum LocalAgentTests {
    static func run() {
        keepsKeysThisBuildDoesNotKnow()
        readsDevicesFromTheCatalog()
        groupsOwnComputersApartFromCloud()
        namesAComputersAgentOnce()
        defaultsToAUsableCloudAgent()
        namesCloudOnlyProviders()
        print("Local agents passed")
    }

    private static func keepsKeysThisBuildDoesNotKnow() {
        let stored = JSONValue.parse(#"{"awsRoleIds":["aws-1"],"deviceIds":["mac"],"futureIds":["x"],"updatedAt":"2026-01-01T00:00:00Z","updatedBy":"u1"}"#)!
        var selection = CredentialSelection(json: stored)
        precondition(selection.ids["deviceIds"] == ["mac"])
        precondition(!selection.isBlank)

        selection.ids["awsRoleIds"] = []
        let sent = selection.json
        precondition(sent["futureIds"] == .array([.string("x")]), "unknown keys must round-trip")
        precondition(sent["deviceIds"] == .array([.string("mac")]))
        precondition(sent["awsRoleIds"] == .array([]))
        precondition(sent["updatedAt"] == nil && sent["updatedBy"] == nil)

        let onlyUnknown = CredentialSelection(json: JSONValue.parse(#"{"futureIds":["x"]}"#)!)
        precondition(onlyUnknown.isEmpty && !onlyUnknown.isBlank)

        var cleared = selection
        cleared.clearAll()
        precondition(cleared.isEmpty)
        precondition(cleared.json["futureIds"] == .array([]), "Clear all must revoke keys this build cannot show")
        precondition(cleared.json["deviceIds"] == .array([]))

        let data = try! JSONEncoder().encode(selection)
        precondition(try! JSONDecoder().decode(CredentialSelection.self, from: data) == selection)
        let legacy = #"{"ids":{"awsRoleIds":["aws-1"]}}"#.data(using: .utf8)!
        precondition(try! JSONDecoder().decode(CredentialSelection.self, from: legacy).ids["awsRoleIds"] == ["aws-1"])
    }

    private static func readsDevicesFromTheCatalog() {
        let catalog = CredentialCatalog(json: JSONValue.parse(#"{"devices":[{"deviceId":"mac","label":"MacBook","platform":"darwin"}]}"#)!)
        let item = catalog.allItems.first!
        precondition(item.provider.selectionKey == "deviceIds")
        precondition(item.label == "MacBook" && item.detail == "macOS")
        var selection = CredentialSelection()
        selection.toggle(item)
        precondition(selection.json["deviceIds"] == .array([.string("mac")]))
    }

    private static func agent(_ json: String) -> RuntimeInstance {
        try! JSONDecoder().decode(RuntimeInstance.self, from: json.data(using: .utf8)!)
    }

    private static let macbook = agent(#"{"id":"local_u1_mac","provider":"claude-code","label":"MacBook · Claude Code","status":"active","kind":"local","local":{"ownerUserId":"u1","deviceId":"mac","deviceLabel":"MacBook","signedIn":true}}"#)
    private static let signedOut = agent(#"{"id":"local_u1_pc_codex","provider":"codex","label":"PC · Codex","status":"active","kind":"local","local":{"ownerUserId":"u1","deviceId":"pc","deviceLabel":"PC","signedIn":false}}"#)
    private static let cloud = agent(#"{"id":"rt_1","provider":"claude-code","label":"Team Claude","status":"active","kind":"managed"}"#)

    private static func groupsOwnComputersApartFromCloud() {
        let groups = RuntimeInstance.grouped([cloud, macbook, signedOut])
        precondition(groups.map(\.tier) == [.myComputers, .cloud])
        precondition(groups[0].runtimes.map(\.id) == [macbook.id, signedOut.id])
        precondition(groups[0].tier.title == "My computers" && groups[1].tier.title == "Cloud")
    }

    private static func namesAComputersAgentOnce() {
        precondition(macbook.name == "MacBook" && macbook.subtitle == "Claude Code")
        precondition(cloud.name == "Team Claude" && cloud.subtitle == nil)
        precondition(!signedOut.isSelectable)
        precondition(signedOut.subtitle == "Codex · Signed out · sign in to Codex on that computer")
        let unlabelled = agent(#"{"id":"local_u1_x","provider":"claude-code","label":"Mini · Claude Code","status":"active","kind":"local"}"#)
        precondition(unlabelled.name == "Mini")
    }

    private static func defaultsToAUsableCloudAgent() {
        precondition(RuntimeInstance.defaultPick([macbook, cloud])?.id == cloud.id)
        precondition(RuntimeInstance.defaultPick([signedOut, macbook])?.id == macbook.id)
        precondition(RuntimeInstance.defaultPick([signedOut]) == nil)
    }

    private static func namesCloudOnlyProviders() {
        let grok = agent(#"{"id":"rt_2","provider":"grok","label":"Team Grok","status":"active","kind":"managed"}"#)
        let antigravity = agent(#"{"id":"rt_3","provider":"antigravity","label":"Team Antigravity","status":"active","kind":"managed"}"#)
        precondition(grok.providerName == "Grok Build" && RuntimeInstance.Provider.logo("grok") == "logo-grok")
        precondition(antigravity.providerName == "Antigravity" && RuntimeInstance.Provider.logo("antigravity") == "logo-antigravity")
    }
}

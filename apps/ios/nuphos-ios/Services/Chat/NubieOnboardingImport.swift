#if os(iOS)
import Foundation

enum NubieOnboardingImport {
    private static let key = "nuphos-guide"

    private struct Batch: Decodable {
        struct Item: Decodable {
            let key: String
            let sessionId: String
            let state: String
            let privateChatId: String?
            let error: String?
        }

        let id: String
        let items: [Item]
    }

    private struct Selection: Encodable {
        let botKeys: [String]
        let chatKeys: [String] = []
        let enableSchedules = false
    }

    static func run(
        token: String, teamId: String, runtime: RuntimeInstance, title: String, avatar: String, locale: Locale,
        connectors: [(key: String, title: String)]
    ) async throws -> PushTarget {
        let connectors = connectors.filter {
            guard CredentialCatalog.connectKeys[$0.key] != nil, let connector = Connector.named($0.key) else { return false }
            switch connector.bind {
            case .oauth, .githubApp: return true
            case .form, .desktopOnly: return false
            }
        }
        let archive = try makeBundle(locale: locale, connectors: connectors)
        let query = [
            URLQueryItem(name: "teamId", value: teamId),
            URLQueryItem(name: "runtimeId", value: runtime.id),
            URLQueryItem(name: "agentRuntime", value: runtime.provider.rawValue),
        ]
        let preview = try await AgentChatAPI.send(
            "POST", "agent/bot-imports/preview", query: query, token: token,
            body: Optional<Selection>.none, zipBody: archive
        )
        let batch = try JSONDecoder().decode(Batch.self, from: preview)
        guard let previewItem = batch.items.first(where: { $0.key == key }) else {
            throw NuphosAPI.Failure.invalidResponse
        }

        let item: Batch.Item
        if previewItem.state == "applied" {
            item = previewItem
        } else {
            let applied = try await AgentChatAPI.send(
                "POST", "agent/bot-imports/\(batch.id)/apply", query: query, token: token,
                body: Selection(botKeys: [key]), timeout: 90
            )
            let result = try JSONDecoder().decode(Batch.self, from: applied)
            guard let appliedItem = result.items.first(where: { $0.key == key }) else {
                throw NuphosAPI.Failure.invalidResponse
            }
            item = appliedItem
        }

        guard item.state == "applied", let channelId = item.privateChatId, !channelId.isEmpty else {
            throw NuphosAPI.Failure.http(422, message: item.error ?? String(localized: "Couldn’t set up Nubie. Try again."))
        }
        try await AgentChatAPI.rename(token: token, teamId: teamId, sessionId: item.sessionId, title: title)
        _ = try await AgentChatAPI.send(
            "PATCH", "agent/conversations/\(item.sessionId)/avatar",
            query: [URLQueryItem(name: "teamId", value: teamId)], token: token,
            body: ["avatar": avatar]
        )
        return PushTarget(
            teamId: teamId, sessionId: channelId, title: title,
            onboardingBotId: item.sessionId, onboardingConnectorKeys: connectors.map(\.key)
        )
    }

    private struct Manifest: Codable {
        struct Bot: Codable {
            let key: String
            let name: String
            var instructions: String
            var greeting: String?
            let schedules: [Schedule]
        }

        struct Source: Codable {
            let application: String
            let templateId: String
            let version: String
        }

        struct Schedule: Codable {
            let name: String
            let cron: String
            let timezone: String
            let prompt: String
        }

        let format: String
        let version: Int
        let source: Source
        let requirements: [String]
        var bots: [Bot]
    }

    private static func makeBundle(locale: Locale, connectors: [(key: String, title: String)]) throws -> Data {
        guard let url = Bundle.main.url(forResource: "NubieOnboarding", withExtension: "json") else {
            throw NuphosAPI.Failure.invalidResponse
        }
        var manifest = try JSONDecoder().decode(Manifest.self, from: Data(contentsOf: url))
        guard let index = manifest.bots.firstIndex(where: { $0.key == key }) else {
            throw NuphosAPI.Failure.invalidResponse
        }

        let traditionalChinese = locale.identifier == "zh-Hant"
        let names = connectors.map(\.title).joined(separator: traditionalChinese ? "、" : ", ")
        let selected = connectors.map { "\($0.title) (\($0.key))" }.joined(separator: ", ")
        let introduction = traditionalChinese
            ? "歡迎！這是 Nuphos 送你的第一台 Box，也就是一台雲端電腦。它附有免費 AI 試用額度，讓你先交給我一件小事，看看 Bot 能怎麼幫你。"
            : "Welcome! This is your first Box, a cloud computer from Nuphos. It comes with free AI trial credit, so you can give me a small task and see what a Bot can do."
        let invitation: String
        if connectors.isEmpty {
            invitation = traditionalChinese ? "想先試哪件小事？" : "What would you like to try first?"
        } else if connectors.count == 1, connectors.first?.key == "linear" {
            invitation = traditionalChinese
                ? "你剛才選了 Linear。點下方的「連接 Linear」，我就能用試用額度幫你看看手上有哪些待辦。"
                : "You picked Linear. Tap Connect Linear below to try using your trial credit to see what’s on your to-do list."
        } else if traditionalChinese {
            invitation = "你剛才選了\(names)。選下方想連接的工具，就能用試用額度跑一個小任務。"
        } else {
            invitation = "You picked \(names). Pick a tool below to connect it and try a small task with your trial credit."
        }
        let trial = traditionalChinese
            ? "這台 Box 是暫時給你試用的。等你想繼續使用，我再帶你連接自己的 AI 訂閱或電腦。"
            : "This Box is for a limited trial. When you’re ready to keep going, I can help you connect your own AI subscription or computer."
        manifest.bots[index].greeting = [introduction, trial, invitation].joined(separator: "\n\n")
        let language = traditionalChinese
            ? "使用者在 onboarding 選擇了繁體中文（台灣）。每輪都用繁體中文回覆。即使使用者只說 Hi、Hey、OK，或夾用英文產品名稱，也維持繁體中文。只有使用者明確要求改用其他語言時才切換。"
            : "The user selected \(Locale(identifier: "en").localizedString(forIdentifier: locale.identifier) ?? locale.identifier) during onboarding. Reply in that language every turn. A greeting, short acknowledgement, or product name in another language does not change this preference. Switch only when explicitly asked."
        manifest.bots[index].instructions = """
        \(language)

        \(manifest.bots[index].instructions)

        iOS onboarding:
        The user has a temporary starter Box with free AI trial credit. Do not quote a dollar amount or push them to connect their own subscription or computer before trying it.
        Connector interests: \(selected.isEmpty ? "none selected" : selected).
        These are interests only. The iOS onboarding chat offers buttons that start authorization and give this Bot access. If they ask to connect an onboarding connector, point them to its button and wait for confirmation. Never claim access until verified.
        Once connected and selected, help them try a small read-only task, such as listing a few of their Linear issues. If no connector was selected, offer a small task first. Bring up their own subscription or computer when they want to continue beyond the trial. Use the Bot’s current name.
        """

        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return zipManifest(try encoder.encode(manifest))
    }

    /// The import API expects a ZIP. A single stored manifest needs no compression.
    private static func zipManifest(_ manifest: Data) -> Data {
        let name = Data("manifest.json".utf8)
        let size = UInt32(manifest.count)
        let nameSize = UInt32(name.count)
        let crc = ~manifest.reduce(UInt32.max) { accumulator, byte in
            (0..<8).reduce(accumulator ^ UInt32(byte)) { value, _ in
                (value >> 1) ^ ((value & 1) == 0 ? 0 : 0xEDB88320)
            }
        }
        var archive = Data()
        func word(_ value: UInt32) { archive.append(contentsOf: [UInt8(truncatingIfNeeded: value), UInt8(truncatingIfNeeded: value >> 8)]) }
        func doubleWord(_ value: UInt32) { word(value); word(value >> 16) }
        doubleWord(0x04034B50)
        word(20); word(0); word(0); word(0); word(33)
        doubleWord(crc); doubleWord(size); doubleWord(size)
        word(nameSize); word(0)
        archive.append(name)
        archive.append(manifest)
        let directoryOffset = UInt32(archive.count)
        doubleWord(0x02014B50)
        word(20); word(20); word(0); word(0); word(0); word(33)
        doubleWord(crc); doubleWord(size); doubleWord(size)
        word(nameSize); word(0); word(0); word(0); word(0)
        doubleWord(0); doubleWord(0)
        archive.append(name)
        let directorySize = UInt32(archive.count) - directoryOffset
        doubleWord(0x06054B50)
        word(0); word(0); word(1); word(1)
        doubleWord(directorySize); doubleWord(directoryOffset)
        word(0)
        return archive
    }

}
#endif

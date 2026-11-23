import Foundation

// The languages Desktop ships; every string needs all of them unless it is marked not to be translated.
let languages: Set = ["zh-Hant", "zh-Hans", "ja", "ko", "th", "id", "es"]
let reviewedLegal: Set = ["zh-Hant", "zh-Hans"]
let file = URL(filePath: CommandLine.arguments[1])
let catalog = try JSONSerialization.jsonObject(with: Data(contentsOf: file)) as! [String: Any]
let strings = catalog["strings"] as! [String: [String: Any]]
var translated = 0
// Every machine is a computer; there is no "cloud computer" (or cloud machine) beside it.
let cloudComputer = try NSRegularExpression(
    pattern: "cloud[ -]?(computer|machine)|(computer|machine)s? in the cloud|雲端電腦|雲電腦|云电脑|云端电脑|クラウドコンピュータ|클라우드 컴퓨터|(computadoras?|ordenador(es)?|máquinas?)( Linux)? en la nube|komputer cloud|คอมพิวเตอร์คลาวด์",
    options: [.caseInsensitive])
// Users meet Bots, Tasks and runtimes, never "agents" (#3250, #4145).
let agent = try NSRegularExpression(
    pattern: "\\b(sub-?)?agen(ts?|tes?)?\\b|代理|エージェント|에이전트|เอเจนต์",
    options: [.caseInsensitive])
// Strings #4145 has not reworded yet. Remove a key here when its wording changes; the list only shrinks.
var unconverted: Set = [
    "%@ request closed. Ask the agent to request it again.",
    "Agent",
    "Agent is working",
    "Agent summary",
    "Ask the agent to schedule recurring work in this conversation.",
    "Connect a cloud account or an integration to let the agent work in it.",
    "Continue in agent",
    "Couldn't stop the agent",
    "Create a workspace for your agents and runtimes, or join one your organization has made available.",
    "Create or join a workspace to start chatting with an agent.",
    "Hide %lld sub-agents",
    "How this runtime appears on the computer and when choosing a runtime for an agent.",
    "Open agent",
    "Show %lld sub-agents",
    "Take over to click, type and scroll here. The agent waits until you hand the desktop back.",
    "The agent is still building this plan — steps, cost and risk arrive before it can be approved.",
    "The agent is working. You can send this when its turn ends.",
    "This agent is busy with another reply.",
    "When an agent needs you to decide something, it shows up here. Answer it and it leaves the Inbox.",
]

for (key, entry) in strings {
    let text = key + (String(data: try JSONSerialization.data(withJSONObject: entry), encoding: .utf8) ?? "")
    precondition(
        cloudComputer.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) == nil,
        "\"\(key)\" calls a computer a cloud computer; every machine in Nuphos is a computer")
    // Consent text keeps "AI agents" until its reviewed rewording lands (#3031).
    if !comment.contains("Legal text"), agent.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) != nil {
        precondition(unconverted.remove(key) != nil, "\"\(key)\" says agent; use Bot, Task or runtime (#4145)")
    }
    let present = languages.intersection((entry["localizations"] as? [String: Any] ?? [:]).keys)
    // Legal and consent text ships in English except in the languages a native speaker reviewed (#3031).
    if (entry["comment"] as? String ?? "").contains("Legal text") {
        precondition(present == reviewedLegal, "\"\(key)\" is legal text translated in \(present.sorted()), reviewed in \(reviewedLegal.sorted())")
        continue
    }
    if entry["shouldTranslate"] as? Bool == false { continue }
    precondition(present == languages, "\"\(key)\" is missing \(languages.subtracting(present).sorted())")
    translated += 1
}
let reworded = unconverted.filter { strings[$0] != nil }
precondition(reworded.isEmpty, "Remove reworded strings from the agent allowlist: \(reworded.sorted())")
precondition(!strings.isEmpty, "No strings in \(file.path)")
print("String catalog passed: \(translated) of \(strings.count) strings translated")

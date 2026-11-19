import Foundation

// The languages Desktop ships; every string needs all of them unless it is marked not to be translated.
let languages: Set = ["zh-Hant", "zh-Hans", "ja", "ko", "th", "id", "es"]
let file = URL(filePath: CommandLine.arguments[1])
let catalog = try JSONSerialization.jsonObject(with: Data(contentsOf: file)) as! [String: Any]
let strings = catalog["strings"] as! [String: [String: Any]]
var translated = 0
// Every machine is a computer; there is no "cloud computer" (or cloud machine) beside it.
let cloudComputer = try NSRegularExpression(
    pattern: "cloud[ -]?(computer|machine)|(computer|machine)s? in the cloud|雲端電腦|雲電腦|云电脑|云端电脑|クラウドコンピュータ|클라우드 컴퓨터|(computadoras?|ordenador(es)?|máquinas?)( Linux)? en la nube|komputer cloud|คอมพิวเตอร์คลาวด์",
    options: [.caseInsensitive])

for (key, entry) in strings {
    // Legal and consent text ships in English until a native speaker reviews its translations.
    let comment = entry["comment"] as? String ?? ""
    if comment.contains("Legal text"), !comment.contains("Reviewed translations") {
        let unreviewed = Set((entry["localizations"] as? [String: Any] ?? [:]).keys).subtracting(["en"])
        precondition(unreviewed.isEmpty, "\"\(key)\" is legal text with unreviewed translations \(unreviewed.sorted())")
    }
    let text = key + (String(data: try JSONSerialization.data(withJSONObject: entry), encoding: .utf8) ?? "")
    precondition(
        cloudComputer.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) == nil,
        "\"\(key)\" calls a computer a cloud computer; every machine in Nuphos is a computer")
    let present = languages.intersection((entry["localizations"] as? [String: Any] ?? [:]).keys)
    if entry["shouldTranslate"] as? Bool == false { continue }
    precondition(present == languages, "\"\(key)\" is missing \(languages.subtracting(present).sorted())")
    translated += 1
}
precondition(!strings.isEmpty, "No strings in \(file.path)")
print("String catalog passed: \(translated) of \(strings.count) strings translated")

import Foundation

// The languages Desktop ships; every string needs all of them unless it is marked not to be translated.
let languages: Set = ["zh-Hant", "zh-Hans", "ja", "ko", "th", "id", "es"]
let file = URL(filePath: CommandLine.arguments[1])
let catalog = try JSONSerialization.jsonObject(with: Data(contentsOf: file)) as! [String: Any]
let strings = catalog["strings"] as! [String: [String: Any]]
var translated = 0

for (key, entry) in strings {
    let present = languages.intersection((entry["localizations"] as? [String: Any] ?? [:]).keys)
    if entry["shouldTranslate"] as? Bool == false { continue }
    precondition(present == languages, "\"\(key)\" is missing \(languages.subtracting(present).sorted())")
    translated += 1
}
precondition(translated > 0, "No translated strings in \(file.path)")
print("String catalog passed: \(translated) of \(strings.count) strings translated")

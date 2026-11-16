import Foundation

// The languages Desktop ships; the catalog must translate a string into all of them or none.
let languages: Set = ["zh-Hant", "zh-Hans", "ja", "ko", "th", "id", "es"]
let file = URL(filePath: CommandLine.arguments[1])
let catalog = try JSONSerialization.jsonObject(with: Data(contentsOf: file)) as! [String: Any]
let strings = catalog["strings"] as! [String: [String: Any]]
var translated = 0

for (key, entry) in strings {
    let present = languages.intersection((entry["localizations"] as? [String: Any] ?? [:]).keys)
    if present.isEmpty { continue }
    precondition(present == languages, "\"\(key)\" is missing \(languages.subtracting(present).sorted())")
    translated += 1
}
precondition(translated > 0, "No translated strings in \(file.path)")
print("String catalog passed: \(translated) of \(strings.count) strings translated")

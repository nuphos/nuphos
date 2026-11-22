import Foundation

/// A preview answers from a fixture: it neither shows a kept chat nor keeps one (#3525).
@main
enum LaunchCachePreviewTests {
    static func main() {
        LaunchCache.keepTranscript(Data("{}".utf8), of: "kept", token: "ada")
        PreviewIsolation.installIfPreview(arguments: ["-preview-home"], fixture: nil)
        precondition(LaunchCache.transcript(of: "kept", token: "ada") == nil, "A preview showed a kept chat")
        LaunchCache.keepTranscript(Data("{}".utf8), of: "new", token: "ada")
        precondition(!FileManager.default.fileExists(atPath: LaunchCache.transcriptURL(of: "new", token: "ada").path), "A preview kept a chat")
        print("Launch cache preview passed")
    }
}

import Foundation
import UniformTypeIdentifiers

enum PastedFileTests {
    static func run() {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try! FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        // The clipboard hands over temp files with no extension.
        let png = dir.appendingPathComponent("pasteboard-item")
        try! Data([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]).write(to: png)

        let provider = NSItemProvider()
        provider.suggestedName = "Screenshot"
        provider.registerFileRepresentation(for: .pdf, visibility: .all, openInPlace: false) { done in
            done(nil, false, CocoaError(.fileNoSuchFile))
            return nil
        }
        provider.registerFileRepresentation(for: .png, visibility: .all, openInPlace: false) { done in
            done(png, false, nil)
            return nil
        }
        let file = wait { await PastedFile.load(provider) }!
        precondition(file.type == .png, "a representation that fails to load falls through to the next")
        precondition(file.name == "Screenshot.png", "the copier's name, with the advertised type's extension")
        precondition(file.url.pathExtension == "png")
        precondition(try! Data(contentsOf: file.url) == Data(contentsOf: png))

        precondition(wait { await PastedFile.load(NSItemProvider()) } == nil)

        // A copied link or rich text pastes as text; an image or a named file attaches.
        func copied(_ types: [UTType], name: String? = nil) -> NSItemProvider {
            let provider = NSItemProvider()
            provider.suggestedName = name
            for type in types {
                provider.registerDataRepresentation(for: type, visibility: .all) { done in
                    done(Data("https://nuphos.ai".utf8), nil)
                    return nil
                }
            }
            return provider
        }
        precondition(PastedFile.isText(copied([.url, .utf8PlainText])), "a copied link")
        precondition(PastedFile.isText(copied([.flatRTFD, .rtf, .utf8PlainText])), "copied rich text")
        precondition(PastedFile.isText(copied([.utf8PlainText])))
        precondition(!PastedFile.isText(copied([.png])), "a screenshot")
        precondition(!PastedFile.isText(copied([.png, .utf8PlainText])), "an image that also carries text")
        precondition(!PastedFile.isText(copied([.utf8PlainText], name: "notes.txt")), "a file from Files")
    }

    private final class Box<T>: @unchecked Sendable { var value: T? }

    private static func wait<T>(_ body: @escaping @Sendable () async -> T) -> T {
        let box = Box<T>()
        let done = DispatchSemaphore(value: 0)
        Task.detached {
            box.value = await body()
            done.signal()
        }
        done.wait()
        return box.value!
    }
}

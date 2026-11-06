import Foundation

/// A file opened once opens again from disk: no re-signed link, no download,
/// so the viewer shows no spinner. Links change on every read, as the store's do.
enum TransferFilesTests {
    static func run() {
        let done = DispatchSemaphore(value: 0)
        Task.detached {
            await reopensFromDiskWithoutTheNetwork()
            await fetchesOnlyWhatIsMissing()
            await opensACopyOffline()
            keepsTheCopiesBounded()
            done.signal()
        }
        precondition(done.wait(timeout: .now() + 10) == .success, "transfer file tests must finish")
        print("Transfer file cache passed")
    }

    /// Counts every request and answers it with the file's id.
    final class Store: URLProtocol {
        nonisolated(unsafe) static var requests: [String] = []
        override class func canInit(with request: URLRequest) -> Bool { true }
        override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
        override func startLoading() {
            Store.requests.append(request.url!.path)
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: nil)!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: Data(request.url!.path.utf8))
            client?.urlProtocolDidFinishLoading(self)
        }
        override func stopLoading() {}
    }

    private final class Links: @unchecked Sendable {
        var reads = 0
        var failing = false
        let files: [TransferDownloadGroup.File]
        init(_ files: [TransferDownloadGroup.File]) { self.files = files }
        /// Signs every file anew, as the store does on each read.
        func read() throws -> [TransferDownloadGroup.File] {
            reads += 1
            if failing { throw URLError(.notConnectedToInternet) }
            return files.map { .init(id: $0.id, fileName: $0.fileName, contentType: nil, status: "ready",
                                     downloadUrl: "https://store.invalid/\($0.id)?signature=\(reads)") }
        }
    }

    private static let session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [Store.self]
        return URLSession(configuration: configuration)
    }()

    private static func file(_ id: String, _ name: String) -> TransferDownloadGroup.File {
        .init(id: id, fileName: name, contentType: nil, status: "ready", downloadUrl: nil)
    }

    private static func root() -> URL {
        FileManager.default.temporaryDirectory.appending(path: "transfer-files-\(UUID().uuidString)")
    }

    private static func open(_ wanted: [TransferDownloadGroup.File], _ tapped: TransferDownloadGroup.File,
                             _ links: Links, _ root: URL) async -> [String: URL] {
        do {
            return try await TransferFiles.localCopies(of: wanted, tapped: tapped, links: { try links.read() }, root: root, session: session)
        } catch { preconditionFailure("open failed: \(error)") }
    }

    private static func reopensFromDiskWithoutTheNetwork() async {
        let root = root()
        let a = file("img-a", "a.png"), b = file("img-b", "b.png"), pdf = file("doc", "report.pdf")
        let links = Links([a, b, pdf])
        Store.requests = []

        let first = await open([a, b], a, links, root)
        precondition(links.reads == 1 && Store.requests.count == 2, "the first open fetches the group's images")
        let again = await open([a, b], a, links, root)
        precondition(links.reads == 1 && Store.requests.count == 2, "a second image open makes no request")
        precondition(again == first && (try? String(contentsOf: again["img-a"]!, encoding: .utf8)) == "/img-a")

        _ = await open([pdf], pdf, links, root)
        precondition(links.reads == 2 && Store.requests.count == 3, "the first PDF open fetches it")
        _ = await open([pdf], pdf, links, root)
        precondition(links.reads == 2 && Store.requests.count == 3, "a second PDF open makes no request")
    }

    private static func fetchesOnlyWhatIsMissing() async {
        let root = root()
        let a = file("img-a", "a.png"), b = file("img-b", "b.png")
        let links = Links([a, b])
        _ = await open([a], a, links, root)
        Store.requests = []
        let locals = await open([a, b], a, links, root)
        precondition(Store.requests == ["/img-b"] && locals.count == 2, "only the missing image is fetched")
    }

    private static func opensACopyOffline() async {
        let root = root()
        let a = file("img-a", "a.png"), b = file("img-b", "b.png")
        let links = Links([a, b])
        _ = await open([a], a, links, root)
        links.failing = true
        let locals = await open([a, b], a, links, root)
        precondition(locals.keys.sorted() == ["img-a"], "a copy on disk opens without fresh links")
    }

    private static func keepsTheCopiesBounded() {
        let root = root()
        for (i, id) in ["old", "mid", "new"].enumerated() {
            let dir = root.appending(path: id)
            try! FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            let url = dir.appending(path: "f")
            try! Data(count: 8192).write(to: url)
            try! FileManager.default.setAttributes([.modificationDate: Date(timeIntervalSince1970: Double(i))], ofItemAtPath: url.path)
        }
        TransferFiles.trim(root, keeping: ["old"], limit: 10_000)
        let left = (try? FileManager.default.contentsOfDirectory(atPath: root.path).sorted()) ?? []
        precondition(left == ["new", "old"], "the oldest copies go, except ones being shown: \(left)")
    }
}

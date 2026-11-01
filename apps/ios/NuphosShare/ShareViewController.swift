import UIKit
import SwiftUI
import Observation
import Darwin
import UniformTypeIdentifiers

/// The extension only receives content. Editing and preparation use the same
/// ChatComposerBar and ComposerSubmission implementation as the containing app.
final class ShareViewController: UIViewController {
    private let model = ShareComposerModel()
    private let operationDirectory = FileManager.default.temporaryDirectory.appendingPathComponent("NuphosShareOperation-" + UUID().uuidString, isDirectory: true)
    private var files: [(String, String, URL)] = []
    private var temporary: [URL] = []
    private var task: Task<Void, Never>?
    private var finished = false
    private var operationLock: Int32 = -1

    override func viewDidLoad() {
        super.viewDidLoad()
        do {
            try FileManager.default.createDirectory(at: operationDirectory, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.complete])
            operationLock = open(operationDirectory.appendingPathComponent("operation.lock").path, O_CREAT | O_RDWR, 0o600)
            guard operationLock >= 0, flock(operationLock, LOCK_EX | LOCK_NB) == 0 else { throw SharePayloadLimits.Failure.invalidFile }
            model.temporaryDirectory = operationDirectory
            for item in (try? FileManager.default.contentsOfDirectory(at: FileManager.default.temporaryDirectory, includingPropertiesForKeys: [.contentModificationDateKey])) ?? [] {
                guard item != operationDirectory, item.lastPathComponent.hasPrefix("NuphosShareOperation-"),
                      let modified = try? item.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate,
                      Date().timeIntervalSince(modified) > 600 else { continue }
                let staleLock = open(item.appendingPathComponent("operation.lock").path, O_RDWR)
                guard staleLock >= 0 else { continue }
                defer { close(staleLock) }
                guard flock(staleLock, LOCK_EX | LOCK_NB) == 0 else { continue }
                try? FileManager.default.removeItem(at: item)
            }
        } catch { model.error = error.localizedDescription }

        model.discardFiles = { [weak self] in self?.cleanup() }
        let host = UIHostingController(rootView: ShareConversationView(model: model, cancel: { [weak self] in self?.cancelShare() }))
        addChild(host); view.addSubview(host.view); host.view.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([host.view.leadingAnchor.constraint(equalTo: view.leadingAnchor), host.view.trailingAnchor.constraint(equalTo: view.trailingAnchor), host.view.topAnchor.constraint(equalTo: view.topAnchor), host.view.bottomAnchor.constraint(equalTo: view.bottomAnchor)])
        host.didMove(toParent: self)
        if model.error == nil { task = Task { await loadItems(); if model.loaded { await model.restore() } } }
    }
    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        if presentingViewController == nil && view.window == nil && !finished { cancelShare() }
    }
    private func loadItems() async {
        let loadingEpoch = model.epoch
        do {
            let items = extensionContext?.inputItems.compactMap { $0 as? NSExtensionItem } ?? []
            var text: [String] = []; var count = 0
            for item in items {
                if let value = item.attributedContentText?.string, !value.isEmpty { text.append(value) }
                for provider in item.attachments ?? [] {
                    try Task.checkCancellation(); count += 1
                    guard count <= SharePayloadLimits.maxFiles else { throw SharePayloadLimits.Failure.capacity }
                    if provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) {
                        guard let url = try await value(provider, type: UTType.fileURL.identifier) as? URL, url.isFileURL else { throw SharePayloadLimits.Failure.invalidFile }
                        try retain(url, name: provider.suggestedName ?? url.lastPathComponent, type: UTType(filenameExtension: url.pathExtension)?.identifier ?? UTType.data.identifier)
                    } else if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
                        guard let url = try await value(provider, type: UTType.url.identifier) as? URL, ["http", "https"].contains(url.scheme?.lowercased() ?? "") else { throw SharePayloadLimits.Failure.invalidFile }
                        text.append(url.absoluteString)
                    } else if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
                        guard let string = try await value(provider, type: UTType.plainText.identifier) as? String else { throw SharePayloadLimits.Failure.invalidFile }; text.append(string)
                    } else if provider.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
                        let url = try await imageRepresentation(provider); files.append((provider.suggestedName ?? "Shared image.png", UTType.png.identifier, url))
                    } else if let type = provider.registeredTypeIdentifiers.first(where: { UTType($0)?.conforms(to: .data) == true }) {
                        let url = try await representation(provider, type: type); files.append((provider.suggestedName ?? "Shared file", type, url))
                    } else { throw SharePayloadLimits.Failure.invalidFile }
                }
            }
            try Task.checkCancellation()
            guard model.epoch == loadingEpoch else { cleanup(); return }
            guard !finished, !text.isEmpty || !files.isEmpty else { throw SharePayloadLimits.Failure.invalidFile }
            let message = text.reduce(into: [String]()) { if !$0.contains($1) { $0.append($1) } }.joined(separator: "\n\n")
            guard message.utf8.count <= SharePayloadLimits.maxTextBytes else { throw SharePayloadLimits.Failure.capacity }
            let attachments = try files.map { name, type, url -> ComposerAttachment in
                if UTType(type)?.conforms(to: .image) == true {
                    guard let jpeg = ImageAttachment.jpeg(from: try Data(contentsOf: url)) else { throw SharePayloadLimits.Failure.invalidFile }
                    return ComposerAttachment(name: name, kind: .image(jpeg))
                }
                return ComposerAttachment(name: name, kind: .file(url))
            }
            model.text = message
            model.attachments = attachments
            model.loaded = true
        } catch { model.error = error.localizedDescription; cleanup() }
    }
    private func value(_ provider: NSItemProvider, type: String) async throws -> NSSecureCoding {
        try await withCheckedThrowingContinuation { continuation in
            provider.loadItem(forTypeIdentifier: type, options: nil) { value, error in
                if let error { continuation.resume(throwing: error) }
                else if let value { continuation.resume(returning: value) }
                else { continuation.resume(throwing: SharePayloadLimits.Failure.invalidFile) }
            }
        }
    }
    private func imageRepresentation(_ provider: NSItemProvider) async throws -> URL {
        let object = try await value(provider, type: UTType.image.identifier)
        let image: UIImage?
        if let value = object as? UIImage { image = value }
        else if let data = object as? Data { image = UIImage(data: data) }
        else if let url = object as? URL { image = UIImage(contentsOfFile: url.path) }
        else { image = nil }
        guard let image, let cgImage = image.cgImage,
              cgImage.width <= 16_000_000 / max(1, cgImage.height),
              let data = image.pngData() else { throw SharePayloadLimits.Failure.invalidFile }
        guard data.count <= SharePayloadLimits.maxFileBytes else { throw SharePayloadLimits.Failure.capacity }
        let target = self.operationDirectory.appendingPathComponent(UUID().uuidString)
        try data.write(to: target, options: [.atomic, .completeFileProtection])
        if finished { try? FileManager.default.removeItem(at: target); throw CancellationError() }
        temporary.append(target)
        return target
    }
    private func representation(_ provider: NSItemProvider, type: String) async throws -> URL {
        try await withCheckedThrowingContinuation { continuation in
            provider.loadFileRepresentation(forTypeIdentifier: type) { url, error in
                do {
                    if let error { throw error }; guard let url else { throw SharePayloadLimits.Failure.invalidFile }
                    let bytes = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? Int.max
                    guard bytes <= SharePayloadLimits.maxFileBytes else { throw SharePayloadLimits.Failure.capacity }
                    let target = self.operationDirectory.appendingPathComponent(UUID().uuidString)
                    try FileManager.default.copyItem(at: url, to: target)
                    try FileManager.default.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: target.path)
                    DispatchQueue.main.async {
                        guard !self.finished else {
                            try? FileManager.default.removeItem(at: target)
                            continuation.resume(throwing: CancellationError())
                            return
                        }
                        self.temporary.append(target)
                        continuation.resume(returning: target)
                    }
                } catch { continuation.resume(throwing: error) }
            }
        }
    }
    private func retain(_ source: URL, name: String, type: String) throws {
        let scoped = source.startAccessingSecurityScopedResource(); defer { if scoped { source.stopAccessingSecurityScopedResource() } }
        let bytes = try source.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? Int.max
        guard bytes <= SharePayloadLimits.maxFileBytes else { throw SharePayloadLimits.Failure.capacity }
        let target = self.operationDirectory.appendingPathComponent(UUID().uuidString).appendingPathExtension(source.pathExtension)
        try FileManager.default.copyItem(at: source, to: target); try FileManager.default.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: target.path); temporary.append(target); files.append((name, type, target))
    }
    private func cancelShare() {
        guard !finished else { return }
        finished = true; model.epoch = UUID(); model.openChat?.session.cancelSending(); task?.cancel(); cleanup()
        extensionContext?.cancelRequest(withError: NSError(domain: NSCocoaErrorDomain, code: NSUserCancelledError))
    }
    private func cleanup() {
        try? FileManager.default.removeItem(at: operationDirectory)
        if operationLock >= 0 { close(operationLock); operationLock = -1 }
        for url in temporary + files.map({ $0.2 }) { try? FileManager.default.removeItem(at: url) }
        temporary = []; files = []
    }
    deinit { task?.cancel(); if operationLock >= 0 { close(operationLock) }; try? FileManager.default.removeItem(at: operationDirectory); for url in temporary + files.map({ $0.2 }) { try? FileManager.default.removeItem(at: url) } }
}

@MainActor
@Observable
private final class ShareComposerModel {
    var text = ""
    var attachments: [ComposerAttachment] = []
    var loaded = false
    var temporaryDirectory = FileManager.default.temporaryDirectory
    var epoch = UUID()
    var error: String?
    let auth = AuthSession()
    var store: AgentStore?
    var lease: SharedShareSession.Record?
    var openChat: AgentPage.OpenChat?
    var discardFiles: (() -> Void)?
    var identityInvalidated = false
    var ready: Bool { loaded && store != nil && error == nil }

    func restore() async {
        do {
            guard let lease = try SharedShareSession.read() else { throw SharedShareSession.Failure.signedOut }
            if let captured = self.lease, !SharedShareSession.matches(lease, lease: captured) {
                identityInvalidated = true
                text = ""; attachments = []; discardFiles?()
                throw SharedShareSession.Failure.changed
            }
            self.lease = lease
            try await auth.restoreForSharing(lease)
            let store = AgentStore(token: lease.token, loadsHistory: false)
            if let user = auth.user { store.me = ChatMessage.Sender(name: user.name, avatarURL: user.avatarURL) }
            try await store.prepareForSharing(lease)
            self.lease = lease
            self.store = store
            error = nil
        } catch { self.error = error.localizedDescription }
    }
    func validateAdmission() throws {
        guard let lease, let store, store.selectedTeam?.id == lease.context?.teamID else { throw SharedShareSession.Failure.changed }
        try SharedShareSession.validate(lease)
        guard !store.selectedRuntimeUnavailable, store.credentialsReady else { throw SharedShareSession.Failure.workspace }
    }
    func monitorIdentity() async {
        while !Task.isCancelled {
            if let lease {
                do { try SharedShareSession.validate(lease) }
                catch {
                    openChat?.session.cancelSending()
                    if (error as? SharedShareSession.Failure).map({ if case .changed = $0 { return true }; return false }) == true {
                        identityInvalidated = true
                        text = ""; attachments = []; discardFiles?()
                    }
                    self.error = error.localizedDescription
                    return
                }
            }
            do { try await Task.sleep(for: .seconds(1)) } catch { return }
        }
    }
}

private struct ShareConversationView: View {
    @Bindable var model: ShareComposerModel
    var cancel: () -> Void

    var body: some View {
        NavigationStack {
            Group {
                if let store = model.store, model.ready {
                    ZStack {
                        Theme.chatCanvas.ignoresSafeArea()
                    }
                    .safeAreaInset(edge: .bottom, spacing: 0) {
                        NewChatComposer(openChat: $model.openChat,
                            initialContent: ComposerSubmission(text: model.text, attachments: model.attachments),
                            temporaryDirectory: model.temporaryDirectory,
                            admissionCheck: { try model.validateAdmission() })
                    }
                    .environment(store)
                    .environment(model.auth)
                    .navigationDestination(item: $model.openChat) { chat in
                        ConversationView(session: chat.session, initialPrompt: chat.prompt, temporaryDirectory: model.temporaryDirectory)
                            .environment(store)
                            .environment(model.auth)
                    }
                } else if let error = model.error {
                    ContentUnavailableView {
                        Label("Sharing unavailable", systemImage: "person.crop.circle.badge.exclamationmark")
                    } description: { Text(error) } actions: {
                        if model.loaded && !model.identityInvalidated { Button("Try again") { Task { await model.restore() } } }
                    }
                } else { ProgressView("Preparing conversation…") }
            }
            .navigationTitle(model.store?.selectedTeam?.name ?? "New conversation")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel", action: cancel) } }
            .task { await model.monitorIdentity() }
        }
        .tint(Theme.heading)
    }
}

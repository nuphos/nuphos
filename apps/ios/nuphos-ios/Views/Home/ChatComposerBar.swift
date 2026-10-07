import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

/// The composer. Collapsed it is a single capsule; once focused (or holding
/// text/attachments) it opens into rows: a drag handle, optional controls,
/// the input on its own line, attachment tiles, then `+` and send/stop.
struct ChatComposerBar<Controls: View>: View {
    @Binding var text: String
    var isStreaming = false
    var canSend = true
    var canStop = false
    var sendsDuringTurn = false
    /// The turn accepts steering, so what is typed mid-reply goes into it.
    var canSteer = false
    var allowsAttachments = true
    var failedSubmission: Binding<ComposerSubmission?> = .constant(nil)
    var onSend: (ComposerSubmission) -> Void
    var onStop: (() -> Void)? = nil
    /// Shown above the input while expanded (Credentials picker, permission mode).
    @ViewBuilder var controls: () -> Controls

    @FocusState private var focused: Bool
    @State private var attachments: [ComposerAttachment] = []
    @State private var collapsedByUser = false
    @State private var showPhotos = false
    @State private var showFiles = false
    @State private var attachmentError: String?
    @State private var preparingSubmission = false
    @State private var photoItems: [PhotosPickerItem] = []
    @State private var handleDrag: CGFloat = 0

    private var hasText: Bool { !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    private var hasPayload: Bool { hasText || !attachments.isEmpty }
    private var expanded: Bool { (focused || hasPayload) && !collapsedByUser }
    private var hasControls: Bool { Controls.self != EmptyView.self }

    var body: some View {
        // One TextField, always in the same place in the hierarchy: moving
        // it between branches re-creates it, which drops and re-acquires
        // focus in a loop.
        VStack(alignment: .leading, spacing: 8) {
            if let submission = failedSubmission.wrappedValue {
                Button("Edit unsent message") {
                    text = [submission.text, text].filter { !$0.isEmpty }.joined(separator: "\n\n")
                    attachments.insert(contentsOf: submission.attachments, at: 0)
                    failedSubmission.wrappedValue = nil
                    focused = true
                }
                .padding(.horizontal, 16)
                .padding(.top, 8)
            }
            if expanded {
                dragHandle
                    .transition(.opacity)
            }

            // The controls own the sheets they present (agent setup, pickers).
            // A text field in one of those sheets takes focus from the
            // composer, so the row stays mounted while collapsed; removing it
            // would close the sheet the user is typing in.
            if hasControls {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) { controls() }
                        .padding(.horizontal, 12)
                }
                .frame(height: expanded ? nil : 0)
                .padding(.top, expanded ? -4 : 0)
                .padding(.bottom, expanded ? 0 : -8)
                .opacity(expanded ? 1 : 0)
                .allowsHitTesting(expanded)
                .accessibilityHidden(!expanded)
            }

            HStack(spacing: 8) {
                field
                    .padding(.vertical, expanded ? 4 : 8)
                if !expanded {
                    trailingButton
                        .transition(.opacity)
                }
            }
            .padding(.leading, expanded ? 16 : 18)
            .padding(.trailing, expanded ? 16 : 6)
            .padding(.top, expanded ? 0 : 4)
            .padding(.bottom, expanded ? 0 : 4)

            if expanded, !attachments.isEmpty {
                attachmentStrip
                    .transition(.opacity)
            }

            if expanded {
                HStack(spacing: 8) {
                    attachMenu
                    Spacer(minLength: 0)
                    trailingButton
                }
                .padding(.horizontal, 6)
                .padding(.bottom, 6)
                .transition(.opacity)
            }
        }
        .disabled(preparingSubmission)
        .glassEffect(.regular.interactive(), in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        .animation(.snappy(duration: 0.28), value: expanded)
        .animation(.snappy(duration: 0.25), value: attachments)
        .animation(.easeOut(duration: 0.15), value: hasText)
        .animation(.easeOut(duration: 0.15), value: isStreaming)
        .padding(.horizontal, 16)
        .padding(.bottom, 8)
        .offset(y: handleDrag)
        .onChange(of: focused) { _, isFocused in if isFocused { collapsedByUser = false } }
        .onChange(of: photoItems) { _, items in
            guard !items.isEmpty else { return }
            photoItems = []
            Task {
                for item in items {
                    if let attachment = await ComposerAttachment.load(item) { attachments.append(attachment) }
                    else { attachmentError = "Couldn’t prepare this photo. Try a different photo or choose it from Files." }
                }
            }
        }
        .fileImporter(isPresented: $showFiles, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
            if case .success(let urls) = result {
                attachments.append(contentsOf: urls.compactMap(ComposerAttachment.load(fileURL:)))
            }
        }
        .alert("Couldn't send attachment", isPresented: Binding(get: { attachmentError != nil }, set: { if !$0 { attachmentError = nil } })) {
            Button("OK", role: .cancel) { attachmentError = nil }
        } message: {
            Text(attachmentError ?? "")
        }
        .photosPicker(isPresented: $showPhotos, selection: $photoItems, maxSelectionCount: 6, matching: .images)
        #if DEBUG
        .onAppear {
            let args = ProcessInfo.processInfo.arguments
            if args.contains("-focus-composer") { focused = true }
            if args.contains("-preview-attachments"), attachments.isEmpty { attachments = Self.previewAttachments() }
            if args.contains("-open-photos") { showPhotos = true }
            if args.contains("-open-files") { showFiles = true }
        }
        #endif
    }

    #if DEBUG
    private static func previewAttachments() -> [ComposerAttachment] {
        var result: [ComposerAttachment] = []
        #if canImport(UIKit)
        let image = UIGraphicsImageRenderer(size: CGSize(width: 200, height: 200)).image { ctx in
            UIColor.systemTeal.setFill(); ctx.fill(CGRect(x: 0, y: 0, width: 200, height: 200))
            UIColor.white.setFill(); ctx.fill(CGRect(x: 50, y: 50, width: 100, height: 100))
        }
        if let jpeg = image.jpegData(compressionQuality: 0.8) { result.append(ComposerAttachment(name: "Photo", kind: .image(jpeg))) }
        #endif
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("deploy-notes.pdf")
        try? Data("x".utf8).write(to: url)
        result.append(ComposerAttachment(name: "deploy-notes.pdf", kind: .file(url)))
        return result
    }
    #endif

    // MARK: Pieces

    /// Tap or pull down to put the keyboard away and fold the composer.
    /// The drag is free-form: nothing changes until the finger lifts.
    private var dragHandle: some View {
        Capsule()
            .fill(Theme.muted.opacity(0.6))
            .frame(width: 36, height: 5)
            .frame(maxWidth: .infinity, minHeight: 28)
            .contentShape(Rectangle())
            .onTapGesture { collapse() }
            .gesture(
                // Global space: the composer itself moves with the finger,
                // so a local-space translation would jitter.
                DragGesture(minimumDistance: 4, coordinateSpace: .global)
                    .onChanged { value in
                        handleDrag = max(0, value.translation.height)
                    }
                    .onEnded { value in
                        let shouldClose = value.translation.height > 40 || value.predictedEndTranslation.height > 120
                        withAnimation(.snappy(duration: 0.25)) { handleDrag = 0 }
                        if shouldClose { collapse() }
                    }
            )
            .accessibilityLabel("Collapse composer")
            .accessibilityAddTraits(.isButton)
    }

    private func collapse() {
        focused = false
        collapsedByUser = true
    }

    private var field: some View {
        TextField(isStreaming ? (sendsDuringTurn ? "Send a message…" : "Queue a message…") : "Ask Nuphos anything…", text: $text, axis: .vertical)
            .lineLimit(1...8)
            .font(.body)
            .foregroundStyle(Theme.heading)
            .focused($focused)
            .submitLabel(.send)
            .onSubmit(send)
    }

    private var attachmentStrip: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(attachments) { attachment in
                    AttachmentTile(attachment: attachment) {
                        attachments.removeAll { $0.id == attachment.id }
                    }
                }
            }
            .padding(.horizontal, 12)
        }
    }

    private var attachMenu: some View {
        Menu {
            Button { focused = false; showPhotos = true } label: {
                Label("Photos", systemImage: "photo.on.rectangle")
            }
            Button { focused = false; showFiles = true } label: { Label("Files", systemImage: "folder") }
        } label: {
            Image(systemName: "plus")
                .font(.system(size: 18, weight: .medium))
                .frame(width: 34, height: 34)
                .foregroundStyle(Theme.body)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Attach")
    }

    /// One button, never two: a running turn with nothing typed stops it,
    /// and what is typed goes into that turn where the runtime takes it,
    /// otherwise into the queue.
    private var action: ComposerAction {
        .current(
            isStreaming: isStreaming,
            hasPayload: hasPayload,
            canSteer: canSteer && canSend,
            sendsDuringTurn: sendsDuringTurn,
            canStop: canStop && onStop != nil
        )
    }

    private var trailingButton: some View {
        let action = action
        return Button {
            if action == .stop { onStop?() } else { send() }
        } label: {
            Image(systemName: action.systemImage)
                .font(Theme.Text.secondary.weight(.bold))
                .frame(width: 34, height: 34)
                .foregroundStyle(Theme.chatCanvas)
                .background(filled ? Theme.heading : Theme.muted.opacity(0.6), in: Circle())
        }
        .buttonStyle(.plain)
        .contentTransition(.symbolEffect(.replace))
        .disabled(action != .stop && (!canSend || !hasPayload || (!allowsAttachments && !attachments.isEmpty)))
        .accessibilityLabel(action.accessibilityLabel)
    }

    /// The button reads as active when it will do something: stop a turn, or
    /// take what has been typed.
    private var filled: Bool { action == .stop || hasPayload }

    private func send() {
        guard !preparingSubmission, canSend, hasPayload, allowsAttachments || attachments.isEmpty else { return }
        let draft = ComposerSubmission(text: text.trimmingCharacters(in: .whitespacesAndNewlines), attachments: attachments)
        preparingSubmission = true
        Task {
            defer { preparingSubmission = false }
            do {
                let submission = try await Task.detached(priority: .userInitiated) {
                    var submission = draft
                    let imageIndices = draft.attachments.indices.filter { draft.attachments[$0].isImage }
                    let images = imageIndices.compactMap { index -> Data? in
                        if case .image(let data) = draft.attachments[index].kind { return data }
                        return nil
                    }
                    let fitted = try ChatPayload.fitImages(images) { candidate in
                        var parts: [ChatPart] = [.text(.init(text: draft.text, state: .done))]
                        parts += zip(imageIndices, candidate).map { index, data in
                            .file(.init(mediaType: "image/jpeg", filename: draft.attachments[index].name,
                                        url: "data:image/jpeg;base64," + data.base64EncodedString()))
                        }
                        return try AgentChatAPI.encoder.encode(ChatMessage(role: .user, parts: parts).forWire)
                    }
                    for (index, data) in zip(imageIndices, fitted) {
                        submission.attachments[index].kind = .image(data)
                    }
                    return submission
                }.value
                guard canSend, allowsAttachments || submission.attachments.isEmpty else { return }
                text = ""
                attachments.removeAll { attachment in draft.attachments.contains { $0.id == attachment.id } }
                focused = false
                onSend(submission)
            } catch {
                attachmentError = error.localizedDescription
            }
        }
    }
}

extension ChatComposerBar where Controls == EmptyView {
    /// A composer with no control row.
    init(text: Binding<String>, isStreaming: Bool = false, canSteer: Bool = false, onSend: @escaping (ComposerSubmission) -> Void, onStop: (() -> Void)? = nil) {
        self.init(text: text, isStreaming: isStreaming, canSteer: canSteer, onSend: onSend, onStop: onStop, controls: { EmptyView() })
    }
}

/// A small pill control for the composer's top row.
struct ComposerChip: View {
    var systemImage: String? = nil
    /// An asset-catalog mark (`Logos/`) instead of a symbol.
    var logo: String? = nil
    let title: String
    var isActive = false
    var showsChevron = true

    var body: some View {
        HStack(spacing: 5) {
            if let logo {
                BrandLogo(name: logo, size: 13)
            } else if let systemImage {
                Image(systemName: systemImage).font(.system(size: 11, weight: .semibold))
            }
            Text(title).font(.system(size: 12, weight: .medium)).lineLimit(1)
            if showsChevron {
                Image(systemName: "chevron.down").font(.system(size: 9, weight: .bold)).foregroundStyle(Theme.muted)
            }
        }
        .foregroundStyle(isActive ? Theme.heading : Theme.body)
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(Theme.bubble.opacity(isActive ? 1 : 0.7), in: Capsule())
    }
}

/// A brand mark from the asset catalog, sized like an inline symbol.
/// Monochrome marks are template images and take the foreground colour.
struct BrandLogo: View {
    let name: String
    var size: CGFloat = 16

    var body: some View {
        Image(name)
            .resizable()
            .scaledToFit()
            .frame(width: size, height: size)
    }
}

#Preview {
    @Previewable @State var text = ""
    ZStack(alignment: .bottom) {
        Theme.canvas.ignoresSafeArea()
        ChatComposerBar(text: $text, onSend: { _ in }) {
            ComposerChip(systemImage: "key", title: "Credentials")
            ComposerChip(title: "Auto Mode")
        }
    }
}

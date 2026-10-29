import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

/// The composer. Collapsed it is a single capsule; once focused (or holding
/// text/attachments) it opens into rows: optional controls,
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
    /// What an `@` offers: the viewer's devices and other sessions; nil offers none.
    var mentions: MentionSource? = nil
    /// The team voice input transcribes for; nil hides the microphone.
    var voiceTeamId: String? = nil
    var onSend: (ComposerSubmission) -> Void
    var onStop: (() -> Void)? = nil
    /// Shown above the input while expanded (Credentials picker, permission mode).
    @ViewBuilder var controls: () -> Controls

    @Environment(AuthSession.self) private var session
    @FocusState private var focused: Bool
    /// From focus until the keyboard it raised has finished hiding, so the
    /// page lowers this composer along with its own keyboard.
    @State private var ownsKeyboard = false
    @State private var attachments: [ComposerAttachment] = []
    @State private var showPhotos = false
    @State private var showFiles = false
    @State private var attachmentError: String?
    @State private var preparingSubmission = false
    @State private var photoItems: [PhotosPickerItem] = []
    @State private var dictation: VoiceDictation?
    @State private var transcription: Task<Void, Never>?
    @State private var dictationError: String?
    @State private var mentionResults: [AgentConversation] = []
    #if canImport(UIKit)
    @State private var pasteHandler = ComposerPaste()
    #endif

    private var hasText: Bool { !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    private var hasPayload: Bool { hasText || !attachments.isEmpty }
    private var expanded: Bool { focused || hasPayload }
    private var hasControls: Bool { Controls.self != EmptyView.self }
    private var mentionQuery: String? { mentions == nil ? nil : SessionMention.query(in: text) }
    private var mentionDevices: [CredentialCatalog.Item] {
        guard let query = mentionQuery, let mentions else { return [] }
        return Array(mentions.devices.filter { SessionMention.matches($0.label, query) }.prefix(3))
    }

    var body: some View {
        // One TextField, always in the same place in the hierarchy: moving
        // it between branches re-creates it, which drops and re-acquires
        // focus in a loop.
        // Collapsed, the controls row is zero high; spacing around it would
        // stay, so a collapsed composer has none.
        VStack(alignment: .leading, spacing: expanded ? 8 : 0) {
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
                .opacity(expanded ? 1 : 0)
                .allowsHitTesting(expanded)
                .accessibilityHidden(!expanded)
            }

            if expanded, !mentionResults.isEmpty || !mentionDevices.isEmpty {
                mentionList
                    .transition(.opacity)
            }

            HStack(spacing: 8) {
                // While dictating, the bar takes the input's place; the
                // field stays in the hierarchy so it keeps its identity.
                ZStack {
                    field
                        .padding(.vertical, expanded ? 4 : 8)
                        .opacity(dictation == nil ? 1 : 0)
                        .allowsHitTesting(dictation == nil)
                        .accessibilityHidden(dictation != nil)
                    if let dictation {
                        dictationBar(dictation)
                            .transition(.opacity)
                    }
                }
                if !expanded, dictation == nil {
                    micButton
                        .transition(.opacity)
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

            if expanded, dictation == nil {
                HStack(spacing: 8) {
                    attachButtons
                    Spacer(minLength: 0)
                    micButton
                    trailingButton
                }
                .padding(.horizontal, 6)
                .padding(.bottom, 6)
                .transition(.opacity)
            }
        }
        .padding(.top, expanded ? 12 : 0)
        // The glass answers a touch anywhere on it, so anywhere on it opens
        // the input; the buttons inside still take their own.
        .contentShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
        .onTapGesture { if dictation == nil { focused = true } }
        .gesture(pullDown)
        .accessibilityAction(.escape) { focused = false }
        .glassEffect(.regular.interactive(), in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        .animation(.snappy(duration: 0.28), value: expanded)
        .animation(.snappy(duration: 0.25), value: attachments)
        .animation(.easeOut(duration: 0.15), value: hasText)
        .animation(.easeOut(duration: 0.15), value: isStreaming)
        .animation(.snappy(duration: 0.25), value: dictation == nil)
        .animation(.snappy(duration: 0.25), value: mentionResults)
        .task(id: mentionQuery) {
            guard let query = mentionQuery, let mentions else { mentionResults = []; return }
            // Typing on cancels this task, so only a pause asks the backend.
            try? await Task.sleep(for: .milliseconds(150))
            guard !Task.isCancelled else { return }
            let found = await mentions.search(query)
            if !Task.isCancelled { mentionResults = found }
        }
        .onDisappear(perform: cancelDictation)
        .onChange(of: focused) { _, focused in if focused { ownsKeyboard = true } }
        #if canImport(UIKit)
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardDidHideNotification)) { _ in ownsKeyboard = focused }
        #endif
        .preference(key: ComposerOwnsKeyboard.self, value: ownsKeyboard)
        // A drop is a paste: files and images attach, text joins the draft.
        .onDrop(of: [.item], isTargeted: nil) { providers in
            guard allowsAttachments else { return false }
            paste(providers)
            return true
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 8)
        .onChange(of: photoItems) { _, items in
            guard !items.isEmpty else { return }
            photoItems = []
            Task {
                for item in items {
                    if let attachment = await ComposerAttachment.load(item) { attachments.append(attachment) }
                    else { attachmentError = "Couldn’t prepare this photo or video. Try a different one or choose it from Files." }
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
        .photosPicker(isPresented: $showPhotos, selection: $photoItems, maxSelectionCount: 6, matching: .any(of: [.images, .videos]))
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

    /// A pull down puts the keyboard away. The keyboard does its own
    /// animation, so nothing follows the finger.
    private var pullDown: some Gesture {
        DragGesture(minimumDistance: 12)
            .onChanged { value in
                if value.translation.height > abs(value.translation.width) { focused = false }
            }
    }

    private var field: some View {
        TextField(isStreaming ? (sendsDuringTurn ? "Send a message…" : "Queue a message…") : "Ask Nuphos anything…", text: $text, axis: .vertical)
            .lineLimit(1...8)
            .font(.body)
            .foregroundStyle(Theme.heading)
            .focused($focused)
            .submitLabel(.send)
            // The field keeps a drag for itself once there is a draft to
            // scroll or select in; empty, a pull down on it closes too.
            .simultaneousGesture(pullDown, isEnabled: !hasText)
            .onSubmit(send)
            // A vertical field types the return key as a newline and never submits,
            // under a key labelled Send. One typed newline sends instead; pasted
            // text keeps its lines.
            .onChange(of: text) { old, new in
                guard new.count == old.count + 1 else { return }
                let index = new.index(new.startIndex, offsetBy: zip(old, new).prefix { $0 == $1 }.count)
                var stripped = new
                guard stripped.remove(at: index).isNewline, stripped == old else { return }
                text = stripped
                send()
            }
            #if canImport(UIKit)
            .onReceive(NotificationCenter.default.publisher(for: UITextView.textDidBeginEditingNotification)) { note in
                guard allowsAttachments, let textView = note.object as? UITextView else { return }
                // Focus lands a moment later; it tells this field from others.
                Task { @MainActor in
                    if focused, textView.isFirstResponder { pasteHandler.attach(to: textView) { paste($0) } }
                }
            }
            #endif
            .alert("Voice input failed", isPresented: Binding(get: { dictationError != nil }, set: { if !$0 { dictationError = nil } })) {
                Button("OK", role: .cancel) { dictationError = nil }
            } message: {
                Text(dictationError ?? "")
            }
    }

    // MARK: Mentions

    private var mentionList: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(mentionDevices) { device in
                mentionRow(symbol: "laptopcomputer", title: device.label) {
                    text = SessionMention.insert("@" + device.label, into: text)
                    mentions?.pickDevice(device)
                }
            }
            ForEach(mentionResults) { conversation in
                mentionRow(symbol: "bubble.left", title: conversation.displayTitle) { pickMention(conversation) }
            }
        }
    }

    private func mentionRow(symbol: String, title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: symbol)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(Theme.muted)
                Text(title)
                    .font(.subheadline)
                    .foregroundStyle(Theme.heading)
                    .lineLimit(1)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func pickMention(_ conversation: AgentConversation) {
        guard let source = mentions,
              let link = SessionLink.url(teamId: conversation.teamId ?? source.teamId, sessionId: conversation.sessionId)
        else { return }
        text = SessionMention.insert(link.absoluteString, into: text)
        mentionResults = []
    }

    // MARK: Voice input

    /// iOS only: the macOS build has no microphone entitlement.
    @ViewBuilder private var micButton: some View {
        #if os(iOS)
        if voiceTeamId != nil {
            Button(action: startDictation) {
                Image(systemName: "mic")
                    .font(.system(size: 17, weight: .medium))
                    .frame(width: 34, height: 34)
                    .foregroundStyle(Theme.body)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .hoverEffect()
            .disabled(preparingSubmission)
            .accessibilityLabel("Voice input")
        }
        #endif
    }

    /// ✕ discards the take; ■ transcribes it into the input; ↑ transcribes
    /// it and sends.
    private func dictationBar(_ dictation: VoiceDictation) -> some View {
        HStack(spacing: 10) {
            Button(action: cancelDictation) {
                Image(systemName: "xmark")
                    .font(Theme.Text.secondary.weight(.bold))
                    .frame(width: 34, height: 34)
                    .foregroundStyle(Theme.heading)
                    .background(Theme.muted.opacity(0.25), in: Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Cancel voice input")

            if dictation.phase == .transcribing {
                ProgressView().controlSize(.small)
                Text("Transcribing…")
                    .font(.subheadline)
                    .foregroundStyle(Theme.muted)
                Spacer(minLength: 0)
            } else {
                DictationWaveform(levels: dictation.levels)
                Text(dictation.startedAt, style: .timer)
                    .font(.subheadline.monospacedDigit())
                    .foregroundStyle(Theme.muted)
                    .fixedSize()
            }

            Button { finishDictation(thenSend: false) } label: {
                Image(systemName: "stop.fill")
                    .font(Theme.Text.secondary.weight(.bold))
                    .frame(width: 34, height: 34)
                    .foregroundStyle(Theme.heading)
                    .background(Theme.muted.opacity(0.25), in: Circle())
            }
            .buttonStyle(.plain)
            .disabled(dictation.phase != .recording)
            .accessibilityLabel("Finish voice input")

            Button { finishDictation(thenSend: true) } label: {
                Image(systemName: "arrow.up")
                    .font(Theme.Text.secondary.weight(.bold))
                    .frame(width: 34, height: 34)
                    .foregroundStyle(Theme.chatCanvas)
                    .background(Theme.heading, in: Circle())
            }
            .buttonStyle(.plain)
            .disabled(dictation.phase != .recording || !canSend)
            .accessibilityLabel("Send voice input")
        }
        .padding(.vertical, expanded ? 0 : 4)
    }

    private func startDictation() {
        guard dictation == nil else { return }
        focused = false
        let take = VoiceDictation()
        dictation = take
        Task {
            do {
                try await take.start()
                // Cancelled while the permission prompt was up.
                if dictation !== take { take.cancel() }
            } catch {
                take.cancel()
                if dictation === take { dictation = nil }
                dictationError = error.localizedDescription
            }
        }
    }

    private func finishDictation(thenSend: Bool) {
        guard let take = dictation, let token = session.token, let teamId = voiceTeamId else { return }
        transcription = Task {
            do {
                let words = try await take.finish(token: token, teamId: teamId)
                if !Task.isCancelled, !words.isEmpty {
                    text = text.isEmpty || text.last?.isWhitespace == true ? text + words : text + " " + words
                    if thenSend { send() }
                }
            } catch {
                if !Task.isCancelled { dictationError = error.localizedDescription }
            }
            if dictation === take { dictation = nil }
        }
    }

    private func cancelDictation() {
        transcription?.cancel()
        transcription = nil
        dictation?.cancel()
        dictation = nil
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

    /// Buttons, not a menu: opening a menu takes focus from the input,
    /// which folds an empty composer and takes the menu away with it.
    private var attachButtons: some View {
        HStack(spacing: 0) {
            attachButton("photo", label: "Photos") { showPhotos = true }
            attachButton("paperclip", label: "Files") { showFiles = true }
            // Not the system PasteButton: it always draws a filled block,
            // whatever style it is given, and hides when tinted to match.
            #if canImport(UIKit)
            attachButton("doc.on.clipboard", label: "Paste") { paste(UIPasteboard.general.itemProviders) }
            #endif
        }
    }

    /// Copied files and images become attachments; copied text, which has
    /// no name, goes into the draft as if it were pasted there.
    private func paste(_ providers: [NSItemProvider]) {
        Task {
            for provider in providers {
                if PastedFile.isText(provider),
                   let string = await withCheckedContinuation({ continuation in
                       _ = provider.loadTransferable(type: String.self) { continuation.resume(returning: try? $0.get()) }
                   }) {
                    text += string
                } else if let attachment = await ComposerAttachment.load(pasted: provider) {
                    attachments.append(attachment)
                } else {
                    attachmentError = "Couldn’t paste this item. Try choosing it from Files."
                }
            }
        }
    }

    private func attachButton(_ symbol: String, label: LocalizedStringKey, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 17, weight: .medium))
                .frame(width: 34, height: 34)
                .foregroundStyle(Theme.body)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        #if os(iOS)
        .hoverEffect()
        #endif
        .accessibilityLabel(label)
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
        #if os(iOS)
        .hoverEffect()
        #endif
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

/// Whether a composer raised the keyboard that is on screen.
struct ComposerOwnsKeyboard: PreferenceKey {
    static let defaultValue = false
    static func reduce(value: inout Bool, nextValue: () -> Bool) { value = value || nextValue() }
}

extension ChatComposerBar where Controls == EmptyView {
    /// A composer with no control row.
    init(text: Binding<String>, isStreaming: Bool = false, canSteer: Bool = false, onSend: @escaping (ComposerSubmission) -> Void, onStop: (() -> Void)? = nil) {
        self.init(text: text, isStreaming: isStreaming, canSteer: canSteer, onSend: onSend, onStop: onStop, controls: { EmptyView() })
    }
}

/// The live microphone level, newest at the trailing edge; the part not yet
/// recorded is a dotted baseline.
private struct DictationWaveform: View {
    let levels: [CGFloat]

    var body: some View {
        Canvas { context, size in
            let step: CGFloat = 4, bar: CGFloat = 2
            let count = Int(size.width / step)
            let recorded = levels.suffix(count)
            let blank = count - recorded.count
            for index in 0..<count {
                let level = index < blank ? 0 : recorded[recorded.startIndex + index - blank]
                let height = max(bar, level * size.height)
                let rect = CGRect(x: CGFloat(index) * step, y: (size.height - height) / 2, width: bar, height: height)
                context.fill(Path(roundedRect: rect, cornerRadius: bar / 2),
                             with: .color(index < blank ? Theme.muted.opacity(0.5) : Theme.heading))
            }
        }
        .frame(maxWidth: .infinity)
        .frame(height: 24)
        .accessibilityHidden(true)
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
    .environment(AuthSession())
}

#if canImport(UIKit)
/// SwiftUI's text field takes only text, so a pasted screenshot was dropped.
/// Allowed to edit attributes, its text view accepts images and files too;
/// those become attachments, as with the Paste button, and text stays plain.
final class ComposerPaste: NSObject, UITextPasteDelegate {
    private var onAttach: ([NSItemProvider]) -> Void = { _ in }

    func attach(to textView: UITextView, onAttach: @escaping ([NSItemProvider]) -> Void) {
        self.onAttach = onAttach
        textView.allowsEditingTextAttributes = true
        textView.pasteDelegate = self
    }

    func textPasteConfigurationSupporting(_ textPasteConfigurationSupporting: any UITextPasteConfigurationSupporting,
                                          transform item: any UITextPasteItem) {
        let provider = item.itemProvider
        guard PastedFile.isText(provider) else {
            onAttach([provider])
            return item.setNoResult()
        }
        _ = provider.loadObject(ofClass: NSString.self) { string, _ in
            DispatchQueue.main.async {
                if let string = string as? String { item.setResult(string: string) } else { item.setNoResult() }
            }
        }
    }
}
#endif

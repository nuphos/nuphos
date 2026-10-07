#if os(iOS)
import ChatLayout
import SwiftUI
import UIKit

/// SwiftUI owns the message views; one collection-view controller owns layout
/// and scroll intent. Geometry observations never issue scroll commands.
struct TranscriptList: UIViewControllerRepresentable {
    let rows: [ChatRow]
    let submittedRowID: String?
    let sessionID: String
    let rowContent: (ChatRow) -> AnyView

    func makeUIViewController(context: Context) -> TranscriptController {
        TranscriptController()
    }

    func updateUIViewController(_ controller: TranscriptController, context: Context) {
        controller.update(rows: rows, submittedRowID: submittedRowID,
                          sessionID: sessionID, content: rowContent)
    }
}

final class TranscriptController: UIViewController, UICollectionViewDelegate, ChatLayoutDelegate {
    private let layout = CollectionViewChatLayout()
    private lazy var collection = UICollectionView(frame: .zero, collectionViewLayout: layout)
    private var dataSource: ChatLayoutDiffableDataSource<Int, String>!
    private var rows: [ChatRow] = []
    private var byID: [String: ChatRow] = [:]
    private var content: ((ChatRow) -> AnyView)?
    private var sessionID = ""
    private var submittedID: String?
    private var extendedID: String?
    private var pendingSentAnimationID: String?
    private var following = true
    private var positioned = false
    private var applying = false
    private var pending: (() -> Void)?
    private var previousSize = CGSize.zero
    private let latestButton = UIButton(type: .system)

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .clear
        layout.delegate = self
        layout.settings.estimatedItemSize = CGSize(width: 300, height: 100)
        layout.settings.additionalInsets = UIEdgeInsets(top: 12, left: 0, bottom: 12, right: 0)
        // Hosted rows may resize for disclosure/Markdown changes.
        layout.supportSelfSizingInvalidation = true
        collection.backgroundColor = .clear
        // Plan loads and disclosure toggles change SwiftUI state without a
        // new ChatRow snapshot. Propagate their Auto Layout size changes too.
        collection.selfSizingInvalidation = .enabledIncludingConstraints
        collection.alwaysBounceVertical = true
        collection.keyboardDismissMode = .interactive
        collection.delegate = self
        collection.accessibilityIdentifier = "chat.transcript"
        collection.register(TranscriptCell.self, forCellWithReuseIdentifier: "row")
        collection.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(collection)
        NSLayoutConstraint.activate([
            collection.topAnchor.constraint(equalTo: view.topAnchor),
            collection.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            collection.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            collection.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])
        dataSource = ChatLayoutDiffableDataSource(collectionView: collection) { [weak self] collection, path, id in
            guard let self, let row = self.byID[id], let content = self.content else { return nil }
            let cell = collection.dequeueReusableCell(withReuseIdentifier: "row", for: path) as! TranscriptCell
            cell.configure(AnyView(content(row)
                .environment(\.transcriptReadingInteraction, { [weak self] in
                    self?.following = false
                    self?.layout.keepContentOffsetAtBottomOnBatchUpdates = false
                })
                .fixedSize(horizontal: false, vertical: true).id(id)), parent: self)
            return cell
        }
        var config = UIButton.Configuration.filled()
        config.image = UIImage(systemName: "arrow.down")
        config.cornerStyle = .capsule
        config.baseBackgroundColor = .secondarySystemBackground
        config.baseForegroundColor = .label
        latestButton.configuration = config
        latestButton.accessibilityLabel = "Scroll to latest message"
        latestButton.accessibilityIdentifier = "chat.latest"
        latestButton.addTarget(self, action: #selector(showLatest), for: .touchUpInside)
        latestButton.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(latestButton)
        NSLayoutConstraint.activate([
            latestButton.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -16),
            latestButton.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -12),
        ])
        latestButton.isHidden = true
    }

    func update(rows incoming: [ChatRow], submittedRowID: String?, sessionID: String,
                content: @escaping (ChatRow) -> AnyView) {
        loadViewIfNeeded()
        self.content = content
        self.sessionID = sessionID
        guard !applying, !collection.isDragging, !collection.isDecelerating else {
            pending = { [weak self] in
                self?.update(rows: incoming, submittedRowID: submittedRowID, sessionID: sessionID, content: content)
            }
            return
        }
        let sent = submittedRowID != nil && submittedRowID != submittedID
        guard rows != incoming || sent else { return }
        let anchor = readingAnchor()
        let old = byID
        let updated = Dictionary(uniqueKeysWithValues: incoming.map { ($0.id, $0) })
        var snapshot = NSDiffableDataSourceSnapshot<Int, String>()
        snapshot.appendSections([0])
        snapshot.appendItems(incoming.map(\.id))
        snapshot.reconfigureItems(incoming.filter { old[$0.id] != nil && old[$0.id] != $0 }.map(\.id))
        if sent {
            submittedID = submittedRowID
            pendingSentAnimationID = submittedRowID
            extendedID = incoming.first { $0.id == submittedRowID }?.id
            following = false
        }
        layout.keepContentOffsetAtBottomOnBatchUpdates = positioned && following
        applying = true
        dataSource.apply(snapshot, animatingDifferences: false, commitAlongsideUpdates: {
            self.rows = incoming
            self.byID = updated
            self.layout.settings.indexPathForExtendedLayout = self.extendedID.flatMap { id in
                incoming.firstIndex { $0.id == id }.map { IndexPath(item: $0, section: 0) }
            }
        }, completion: { [weak self] in
            guard let self else { return }
            self.applying = false
            self.updateLatestButton()
            self.flushPending()
        })
        // Batch completion can run after a display frame even without animations,
        // which would show new rows at their estimated size for that frame.
        // Commit the position in the same turn as the change.
        collection.layoutIfNeeded()
        if sent, let id = extendedID {
            restore(id: id, edge: .top, offset: 0)
            positioned = true
        } else if !positioned || following {
            positionAtEnd()
        } else if let anchor {
            restore(id: anchor.id, edge: .top, offset: anchor.offset)
        }
        animatePendingSend()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        let size = collection.bounds.size
        guard size.width > 0, size.height > 0, size != previousSize else { return }
        previousSize = size
        if !positioned, let id = extendedID {
            restore(id: id, edge: .top, offset: 0)
            positioned = true
        } else if !positioned || following { positionAtEnd() }
        animatePendingSend()
    }

    private func animatePendingSend() {
        guard collection.bounds.height > 0,
              let id = pendingSentAnimationID,
              let index = rows.firstIndex(where: { $0.id == id }),
              let cell = collection.cellForItem(at: IndexPath(item: index, section: 0)) else { return }
        pendingSentAnimationID = nil
        // Presentation-only: never animate the layout, reading anchor, or offset.
        let fade = CABasicAnimation(keyPath: "opacity")
        fade.fromValue = 0
        fade.toValue = 1
        let arrival = CAAnimationGroup()
        arrival.animations = [fade]
        if !UIAccessibility.isReduceMotionEnabled {
            let lift = CABasicAnimation(keyPath: "transform.translation.y")
            lift.fromValue = 6
            lift.toValue = 0
            arrival.animations?.append(lift)
        }
        arrival.duration = 0.18
        arrival.timingFunction = CAMediaTimingFunction(name: .easeOut)
        cell.layer.add(arrival, forKey: "sent-arrival")
    }

    private func positionAtEnd() {
        guard collection.bounds.height > 0, let last = rows.last else { return }
        restore(id: last.id, edge: .bottom, offset: 0)
        positioned = true
    }

    private func restore(id: String, edge: ChatLayoutPositionSnapshot.Edge, offset: CGFloat) {
        guard let index = rows.firstIndex(where: { $0.id == id }) else { return }
        UIView.performWithoutAnimation {
            layout.restoreContentOffset(with: .init(indexPath: IndexPath(item: index, section: 0), edge: edge, offset: offset))
            collection.layoutIfNeeded()
        }
    }

    private func readingAnchor() -> (id: String, offset: CGFloat)? {
        guard positioned,
              let attributes = collection.indexPathsForVisibleItems.compactMap({ layout.layoutAttributesForItem(at: $0) })
                .filter({ $0.frame.maxY > layout.visibleBounds.minY })
                .min(by: { $0.frame.minY < $1.frame.minY }),
              rows.indices.contains(attributes.indexPath.item) else { return nil }
        return (rows[attributes.indexPath.item].id,
                attributes.frame.minY - layout.visibleBounds.minY - layout.settings.additionalInsets.top)
    }

    func sizeForItem(_ chatLayout: CollectionViewChatLayout, at indexPath: IndexPath) -> ItemSize {
        return .auto
    }

    @objc private func showLatest() {
        extendedID = nil
        layout.settings.indexPathForExtendedLayout = nil
        following = true
        positionAtEnd()
        updateLatestButton()
    }

    private var nearBottom: Bool {
        layout.collectionViewContentSize.height - collection.bounds.maxY + collection.adjustedContentInset.bottom < 48
    }

    private func updateLatestButton() { latestButton.isHidden = nearBottom }

    func scrollViewWillBeginDragging(_ scrollView: UIScrollView) {
        following = false
        layout.keepContentOffsetAtBottomOnBatchUpdates = false
    }

    func scrollViewDidScroll(_ scrollView: UIScrollView) {
        UIEventLog.chatScroll(sessionId: sessionID, contentOffset: scrollView.contentOffset)
        updateLatestButton()
    }

    func scrollViewDidEndDragging(_ scrollView: UIScrollView, willDecelerate decelerate: Bool) {
        if !decelerate { finishGesture() }
    }

    func scrollViewDidEndDecelerating(_ scrollView: UIScrollView) { finishGesture() }

    private func finishGesture() {
        following = nearBottom
        flushPending()
    }

    private func flushPending() {
        let next = pending
        pending = nil
        next?()
    }

    #if DEBUG
    /// Runs against real UIKit layout and the real Markdown renderer. No API
    /// requests or saved authentication are involved.
    func runScrollRegression() async {
        let stepMarker = TranscriptStepMarker()
        let render: (ChatRow) -> AnyView = { row in
            switch row {
            case .user(_, _, let text, _, _, _):
                AnyView(UserBubble(text: text).padding(16))
            case .assistantText(_, _, let text, let streaming):
                AnyView(AssistantMarkdown(text: text, streaming: streaming).padding(16))
            case .hint(let id, _, _) where id == "step-card":
                AnyView(TranscriptDisclosureFixture(marker: stepMarker).padding(16))
            case .hint:
                AnyView(TranscriptResizingFixture().padding(16))
            default: AnyView(EmptyView())
            }
        }
        var fixture: [ChatRow] = (0..<40).flatMap { index -> [ChatRow] in
            [.user(id: "user.\(index)", messageId: "\(index)", text: "Question \(index)", images: []),
             .assistantText(id: "answer.\(index)", messageId: "a\(index)",
                            text: String(repeating: "Paragraph **\(index)** with a [link](https://example.com). A long response must preserve the reading position.\n\n", count: index == 39 ? 60 : 6), streaming: false)]
        }
        func apply(_ submitted: String? = nil) {
            update(rows: fixture, submittedRowID: submitted, sessionID: "scroll-regression", content: render)
        }
        func pause() async { try? await Task.sleep(for: .seconds(1)) }
        func check(_ name: String, _ passed: Bool, _ detail: String) {
            UIEventLog.regression(name: name, passed: passed, detail: detail)
        }
        apply()
        var openingError: CGFloat = 0
        let probe = TranscriptFrameProbe { [weak self] in
            guard let self else { return }
            let gap = self.layout.collectionViewContentSize.height - self.collection.bounds.maxY + self.collection.adjustedContentInset.bottom
            openingError = max(openingError, abs(gap))
        }
        await pause()
        probe.stop()
        check("open_every_frame", openingError < 20, "maxBottomGap=\(openingError)")
        let opened = collection.contentOffset.y
        // Equivalent to a tap without a pan: no scroll intent is generated.
        collection.layoutIfNeeded()
        await pause()
        check("open_stable", abs(collection.contentOffset.y - opened) < 1 && nearBottom,
              "before=\(opened) after=\(collection.contentOffset.y) nearBottom=\(nearBottom)")
        fixture.append(.user(id: "user.sent", messageId: "sent", text: "A newly sent question", images: []))
        apply("user.sent")
        let sentCell = collection.cellForItem(at: IndexPath(item: fixture.count - 1, section: 0))
        check("sent_transition", sentCell?.layer.animation(forKey: "sent-arrival") != nil,
              "presentation-only duration=0.18")
        func questionY() -> CGFloat {
            guard let index = rows.firstIndex(where: { $0.id == "user.sent" }),
                  let attributes = layout.layoutAttributesForItem(at: IndexPath(item: index, section: 0)) else { return .infinity }
            return attributes.frame.minY - collection.bounds.minY - collection.adjustedContentInset.top
        }
        var sendingError: CGFloat = 0
        let sendingProbe = TranscriptFrameProbe {
            sendingError = max(sendingError, abs(questionY() - 12))
        }
        await pause()
        sendingProbe.stop()
        check("send_every_frame", sendingError < 1, "maxQuestionDrift=\(sendingError)")
        let sentY = questionY()
        await pause()
        check("send_stable", abs(questionY() - sentY) < 1 && abs(sentY) < 20,
              "questionY=\(sentY) after=\(questionY())")
        var streamingError: CGFloat = 0
        let streamingProbe = TranscriptFrameProbe {
            streamingError = max(streamingError, abs(questionY() - sentY))
        }
        fixture.append(.assistantText(id: "answer.sent", messageId: "reply", text: "Starting", streaming: true))
        for step in 1...15 {
            fixture[fixture.count - 1] = .assistantText(id: "answer.sent", messageId: "reply",
                text: String(repeating: "Streaming paragraph with **bold text**.\n\n", count: step), streaming: true)
            apply("user.sent")
            try? await Task.sleep(for: .milliseconds(100))
        }
        await pause()
        streamingProbe.stop()
        check("stream_every_frame", streamingError < 1, "maxQuestionDrift=\(streamingError)")
        check("stream_preserves_question", abs(questionY() - sentY) < 1,
              "before=\(sentY) after=\(questionY())")
        let beforeRefresh = collection.contentOffset.y
        for _ in 0..<5 { apply("user.sent") }
        await pause()
        check("unchanged_refresh", abs(collection.contentOffset.y - beforeRefresh) < 1,
              "before=\(beforeRefresh) after=\(collection.contentOffset.y)")
        showLatest()
        await pause()
        check("latest_button", nearBottom, "offset=\(collection.contentOffset.y)")
        fixture = [.hint(id: "async-card", text: "", isError: false),
                   .user(id: "footer", messageId: "footer", text: "This must remain below the card", images: [])]
        apply("user.sent")
        restore(id: "async-card", edge: .top, offset: 0)
        await pause()
        let cardPath = IndexPath(item: 0, section: 0)
        let footerPath = IndexPath(item: 1, section: 0)
        if let cell = collection.cellForItem(at: cardPath) as? TranscriptCell,
           let card = layout.layoutAttributesForItem(at: cardPath),
           let footer = layout.layoutAttributesForItem(at: footerPath) {
            let fitting = cell.preferredLayoutAttributesFitting(card).size.height
            check("async_card_layout", fitting > 300 && abs(card.size.height - fitting) < 1 && footer.frame.minY >= card.frame.minY + fitting,
                  "allocated=\(card.size.height) fitting=\(fitting) nextY=\(footer.frame.minY)")
        } else { check("async_card_layout", false, "missing cells") }
        fixture = [.hint(id: "step-card", text: "", isError: false),
                   .user(id: "step-footer", messageId: "footer", text: "Below the expanded step", images: [])]
        following = true
        apply("user.sent")
        try? await Task.sleep(for: .milliseconds(400))
        func markerY() -> CGFloat { stepMarker.view?.convert(.zero, to: view).y ?? .infinity }
        let initialY = markerY()
        var stepDrift: CGFloat = 0
        let stepProbe = TranscriptFrameProbe { stepDrift = max(stepDrift, abs(markerY() - initialY)) }
        try? await Task.sleep(for: .seconds(1.5))
        stepProbe.stop()
        let expandedHeight = layout.layoutAttributesForItem(at: cardPath)?.size.height ?? 0
        check("step_anchor", initialY.isFinite && stepDrift < 1 && expandedHeight > 300,
              "maxTitleDrift=\(stepDrift) expandedHeight=\(expandedHeight)")
        check("suite_complete", true, "")
    }
    #endif
}

/// Explicit width-constrained measurement is essential for the embedded
/// Markdown UIView; an estimated hosting-configuration height can otherwise
/// let a long answer draw over the next cell.
private final class TranscriptCell: UICollectionViewCell {
    private let host = UIHostingController(rootView: AnyView(EmptyView()))

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .clear
        host.view.backgroundColor = .clear
        host.view.translatesAutoresizingMaskIntoConstraints = false
        contentView.addSubview(host.view)
        NSLayoutConstraint.activate([
            host.view.topAnchor.constraint(equalTo: contentView.topAnchor),
            host.view.bottomAnchor.constraint(equalTo: contentView.bottomAnchor),
            host.view.leadingAnchor.constraint(equalTo: contentView.leadingAnchor),
            host.view.trailingAnchor.constraint(equalTo: contentView.trailingAnchor),
        ])
        host.sizingOptions = .intrinsicContentSize
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func prepareForReuse() {
        super.prepareForReuse()
        layer.removeAnimation(forKey: "sent-arrival")
    }

    func configure(_ content: AnyView, parent: UIViewController) {
        if host.parent !== parent {
            host.willMove(toParent: nil)
            host.removeFromParent()
            parent.addChild(host)
            host.didMove(toParent: parent)
        }
        host.rootView = content
        host.view.invalidateIntrinsicContentSize()
    }

    override func preferredLayoutAttributesFitting(_ attributes: UICollectionViewLayoutAttributes) -> UICollectionViewLayoutAttributes {
        let result = attributes.copy() as! UICollectionViewLayoutAttributes
        let size = host.sizeThatFits(in: CGSize(width: attributes.size.width, height: .greatestFiniteMagnitude))
        result.size.height = ceil(size.height)
        return result
    }
}

#if DEBUG
private final class TranscriptStepMarker {
    weak var view: UIView?
}

private struct TranscriptStepMarkerView: UIViewRepresentable {
    let marker: TranscriptStepMarker
    func makeUIView(context: Context) -> UIView {
        let view = UIView()
        marker.view = view
        return view
    }
    func updateUIView(_ uiView: UIView, context: Context) {}
}

private struct TranscriptDisclosureFixture: View {
    let marker: TranscriptStepMarker
    @State private var expanded = false
    @Environment(\.transcriptReadingInteraction) private var readingInteraction
    var body: some View {
        DisclosureGroup(isExpanded: $expanded) {
            ForEach(0..<12) { index in
                Text("Command \(index): expanded content below the stationary step title.")
                    .padding(.vertical, 8)
            }
        } label: {
            Text("Step 1 — expand downward")
                .background(TranscriptStepMarkerView(marker: marker))
        }
        .disclosureGroupStyle(PlanStepDisclosureStyle())
        .task {
            try? await Task.sleep(for: .milliseconds(800))
            readingInteraction()
            var transaction = Transaction(animation: nil)
            transaction.disablesAnimations = true
            withTransaction(transaction) { expanded = true }
        }
    }
}

/// Mimics a plan's local-state load without changing the ChatRow snapshot.
private struct TranscriptResizingFixture: View {
    @State private var loaded = false
    var body: some View {
        VStack(alignment: .leading) {
            Text("Asynchronously loaded plan")
            if loaded {
                ForEach(0..<12) { index in
                    Text("Step \(index): Card content must push the following message down.")
                        .padding(.vertical, 6)
                }
            } else { ProgressView() }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.gray.opacity(0.15))
        .task {
            try? await Task.sleep(for: .milliseconds(200))
            loaded = true
        }
    }
}

private final class TranscriptFrameProbe: NSObject {
    private var link: CADisplayLink?
    private let sample: () -> Void
    init(sample: @escaping () -> Void) {
        self.sample = sample
        super.init()
        link = CADisplayLink(target: self, selector: #selector(tick))
        link?.add(to: .main, forMode: .common)
    }
    @objc private func tick() { sample() }
    func stop() { link?.invalidate(); link = nil }
}

struct TranscriptRegressionScreen: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> TranscriptController {
        let controller = TranscriptController()
        Task { @MainActor [weak controller] in
            try? await Task.sleep(for: .milliseconds(500))
            await controller?.runScrollRegression()
        }
        return controller
    }
    func updateUIViewController(_ controller: TranscriptController, context: Context) {}
}
#endif
#endif

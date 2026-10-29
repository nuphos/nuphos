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
    /// Docked on the keyboard layout guide, under the transcript.
    let composer: AnyView
    /// Centered where the rows go while there are none to show.
    let placeholder: AnyView
    let rowContent: (ChatRow) -> AnyView

    func makeUIViewController(context: Context) -> TranscriptController {
        TranscriptController()
    }

    func updateUIViewController(_ controller: TranscriptController, context: Context) {
        controller.setComposer(composer)
        controller.placeholder.rootView = placeholder
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
    private var pendingSentAnimationID: String?
    /// Whether the reader was at the end where they or the transcript last
    /// came to rest. Read from the position itself, so no event can leave it
    /// stale; layout settling under the reader does not count as moving.
    private var following = true
    private var positioned = false
    private var applying = false
    private var pending: (() -> Void)?
    private var previousSize = CGSize.zero
    private let composer = UIHostingController(rootView: AnyView(EmptyView()))
    let placeholder = UIHostingController(rootView: AnyView(EmptyView()))
    private lazy var composerHeight = composer.view.heightAnchor.constraint(equalToConstant: 0)
    private let latestButton = UIButton(type: .system)

    private let root = RotationLayoutView()
    override func loadView() { view = root }

    override func viewWillTransition(to size: CGSize, with coordinator: UIViewControllerTransitionCoordinator) {
        super.viewWillTransition(to: size, with: coordinator)
        // Without a queued animation there is no completion to clear it.
        root.rotating = coordinator.animate(alongsideTransition: nil) { [root] _ in root.rotating = false }
    }

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
        // The composer rides the keyboard layout guide and the collection ends
        // at its top. One keyboard source moves both, inside the keyboard's own
        // animation and interactive drag, and nothing else moves them.
        addChild(composer)
        composer.view.backgroundColor = .clear
        // Its own changes (focus, attachments) then ask for a new layout pass.
        composer.sizingOptions = .intrinsicContentSize
        // The guide already keeps it clear of the keyboard and home indicator;
        // SwiftUI's own keyboard avoidance would move it a second time.
        composer.safeAreaRegions = []
        composer.view.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(composer.view)
        composer.didMove(toParent: self)
        NSLayoutConstraint.activate([
            collection.topAnchor.constraint(equalTo: view.topAnchor),
            collection.bottomAnchor.constraint(equalTo: composer.view.topAnchor),
            collection.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            collection.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            composer.view.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor),
            composer.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            composer.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            composerHeight,
        ])
        addChild(placeholder)
        placeholder.view.backgroundColor = .clear
        placeholder.safeAreaRegions = []
        collection.backgroundView = placeholder.view
        placeholder.didMove(toParent: self)
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
            latestButton.bottomAnchor.constraint(equalTo: collection.bottomAnchor, constant: -12),
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
        let old = byID
        let updated = Dictionary(uniqueKeysWithValues: incoming.map { ($0.id, $0) })
        let anchor = readingAnchor(keeping: updated)
        // Decided before the change: applying it moves the offset itself.
        let follow = !positioned || following
        var snapshot = NSDiffableDataSourceSnapshot<Int, String>()
        snapshot.appendSections([0])
        snapshot.appendItems(incoming.map(\.id))
        snapshot.reconfigureItems(incoming.filter { old[$0.id] != nil && old[$0.id] != $0 }.map(\.id))
        if sent {
            submittedID = submittedRowID
            pendingSentAnimationID = submittedRowID
        }
        layout.keepContentOffsetAtBottomOnBatchUpdates = positioned && follow
        applying = true
        dataSource.apply(snapshot, animatingDifferences: false, commitAlongsideUpdates: {
            self.rows = incoming
            self.byID = updated
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
        if sent || follow {
            UIView.performWithoutAnimation { positionAtEnd() }
        } else if let anchor {
            restore(id: anchor.id, offset: anchor.offset)
        }
        animatePendingSend()
    }

    /// A draft lives in the page's state, so every keystroke arrives here.
    func setComposer(_ content: AnyView) {
        composer.rootView = content
        view.setNeedsLayout()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        // Measured at the page's width: the hosting controller's own intrinsic
        // size has no width, so a long draft would never wrap and grow it.
        let height = ceil(composer.sizeThatFits(in: CGSize(width: view.bounds.width, height: .greatestFiniteMagnitude)).height)
        if composerHeight.constant != height {
            composerHeight.constant = height
            // Counting the composer as part of the keyboard lets a drag pick
            // both up at the composer's top edge.
            view.keyboardLayoutGuide.keyboardDismissPadding = height
        }
        let size = collection.bounds.size
        guard size.width > 0, size.height > 0, size != previousSize else { return }
        previousSize = size
        // Never under a finger or a fling: on iPhone Duo the header resizes the
        // transcript mid-gesture, and moving it then fights the reader. The
        // finger is still down (isTracking) for a moment after isDragging clears.
        if !positioned || (following && !collection.isTracking && !collection.isDragging && !collection.isDecelerating) {
            // Inside the keyboard's animation, so the rows travel with it. A
            // rotation moves them straight to their new layout instead.
            if root.rotating { UIView.performWithoutAnimation(positionAtEnd) } else { positionAtEnd() }
        }
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

    /// The end of the content.
    private func positionAtEnd() {
        guard collection.bounds.height > 0, let last = rows.indices.last else { return }
        hold { scroll(to: .greatestFiniteMagnitude) }
        positioned = true
        following = atEnd
    }

    /// Puts a row's top `offset` points below the top of the visible area.
    private func restore(id: String, offset: CGFloat) {
        guard let index = rows.firstIndex(where: { $0.id == id }) else { return }
        let path = IndexPath(item: index, section: 0)
        UIView.performWithoutAnimation {
            hold {
                guard let frame = layout.layoutAttributesForItem(at: path)?.frame else { return }
                scroll(to: frame.minY - offset - collection.adjustedContentInset.top - layout.settings.additionalInsets.top)
            }
        }
    }

    /// Sets the offset directly, kept within the content. ChatLayout's
    /// restoreContentOffset is not used: it lays out while answering nil for
    /// every item, and UIKit aborts when it needs a visible cell's attributes
    /// in that pass ("missing final attributes for cell").
    private func scroll(to y: CGFloat) {
        let top = -collection.adjustedContentInset.top
        let end = layout.collectionViewContentSize.height - collection.bounds.height + collection.adjustedContentInset.bottom
        collection.contentOffset.y = min(max(y, top), max(top, end))
    }

    /// Rows come into view at their estimated height and are measured by the
    /// next layout pass. Measure them now, then take the position again, so
    /// it is never committed, or clamped, at a size the content will not keep.
    /// A shrink can start UIKit's own animated clamp; left running, it would
    /// pull the reader off the position after this returns.
    private func hold(_ position: () -> Void) {
        collection.setContentOffset(collection.contentOffset, animated: false)
        for _ in 0..<3 {
            position()
            let before = layout.collectionViewContentSize.height
            collection.layoutIfNeeded()
            if layout.collectionViewContentSize.height == before { break }
        }
    }

    /// The first row on screen that the update keeps. When a turn ends, the
    /// rows on screen can all be replaced: its work folds into one row and its
    /// reply takes the server's id. The nearest kept row above them holds the
    /// position then; with no anchor at all, the old offset lands anywhere.
    private func readingAnchor(keeping kept: [String: ChatRow]) -> (id: String, offset: CGFloat)? {
        guard positioned else { return nil }
        let top = layout.visibleBounds.minY
        var anchor: UICollectionViewLayoutAttributes?
        for (index, row) in rows.enumerated() where kept[row.id] != nil {
            guard let attributes = layout.layoutAttributesForItem(at: IndexPath(item: index, section: 0)) else { continue }
            if attributes.frame.maxY > top {
                if anchor == nil || attributes.frame.minY < layout.visibleBounds.maxY { anchor = attributes }
                break
            }
            anchor = attributes
        }
        guard let anchor else { return nil }
        return (rows[anchor.indexPath.item].id, anchor.frame.minY - top - layout.settings.additionalInsets.top)
    }

    func sizeForItem(_ chatLayout: CollectionViewChatLayout, at indexPath: IndexPath) -> ItemSize {
        return .auto
    }

    @objc private func showLatest() {
        positionAtEnd()
        updateLatestButton()
    }

    private var distanceToEnd: CGFloat {
        layout.collectionViewContentSize.height - collection.bounds.maxY + collection.adjustedContentInset.bottom
    }

    /// Close enough that the latest-message button adds nothing.
    private var nearBottom: Bool { distanceToEnd < 48 }

    /// A reader who left the end by any distance is reading, not following.
    private var atEnd: Bool { distanceToEnd < 1 }

    private func updateLatestButton() { latestButton.isHidden = nearBottom }

    func scrollViewWillBeginDragging(_ scrollView: UIScrollView) {
        layout.keepContentOffsetAtBottomOnBatchUpdates = false
    }

    func scrollViewDidScroll(_ scrollView: UIScrollView) {
        UIEventLog.chatScroll(sessionId: sessionID, contentOffset: scrollView.contentOffset)
        updateLatestButton()
    }

    func scrollViewDidEndDragging(_ scrollView: UIScrollView, willDecelerate decelerate: Bool) {
        if !decelerate { settle() }
    }

    func scrollViewDidEndDecelerating(_ scrollView: UIScrollView) { settle() }
    func scrollViewDidEndScrollingAnimation(_ scrollView: UIScrollView) { settle() }
    func scrollViewDidScrollToTop(_ scrollView: UIScrollView) { settle() }

    /// Every way the reader moves the transcript comes to rest here: a drag, a
    /// fling, a status-bar tap, VoiceOver's animated scroll.
    private func settle() {
        following = atEnd
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
            case .hint(let id, let text, let isError) where id.hasPrefix("event."):
                AnyView(HintRow(text: text, isError: isError).padding(.horizontal, 16).padding(.bottom, 18))
            case .activity(let text, let live):
                AnyView(ActivityRow(text: text, live: live).padding(.horizontal, 16).padding(.bottom, 18))
            case .event(_, let event):
                AnyView(EventLine(event: event).padding(.horizontal, 16).padding(.bottom, 18))
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
        let fixture0 = fixture
        func apply(_ submitted: String? = nil) {
            update(rows: fixture, submittedRowID: submitted, sessionID: "scroll-regression", content: render)
        }
        func pause() async { try? await Task.sleep(for: .seconds(1)) }
        func check(_ name: String, _ passed: Bool, _ detail: String) {
            UIEventLog.regression(name: name, passed: passed, detail: detail)
        }
        apply()
        var openingError: CGFloat = 0
        let probe = TranscriptFrameProbe { [unowned self] in openingError = max(openingError, abs(distanceToEnd)) }
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
        // A send sits at the end, above the composer, like any message.
        var sendingError: CGFloat = 0
        let sendingProbe = TranscriptFrameProbe { [unowned self] in sendingError = max(sendingError, abs(distanceToEnd)) }
        await pause()
        sendingProbe.stop()
        check("send_every_frame", sendingError < 1, "maxBottomGap=\(sendingError)")
        let sentOffset = collection.contentOffset.y
        await pause()
        check("send_stable", abs(collection.contentOffset.y - sentOffset) < 1 && abs(distanceToEnd) < 1,
              "before=\(sentOffset) after=\(collection.contentOffset.y) gap=\(distanceToEnd)")
        // The reply streams in below it and the end stays in view.
        var streamingError: CGFloat = 0
        let streamingProbe = TranscriptFrameProbe { [unowned self] in streamingError = max(streamingError, abs(distanceToEnd)) }
        fixture.append(.assistantText(id: "answer.sent", messageId: "reply", text: "Starting", streaming: true))
        for step in 1...15 {
            fixture[fixture.count - 1] = .assistantText(id: "answer.sent", messageId: "reply",
                text: String(repeating: "Streaming paragraph with **bold text**.\n\n", count: step), streaming: true)
            apply("user.sent")
            try? await Task.sleep(for: .milliseconds(100))
        }
        await pause()
        streamingProbe.stop()
        check("stream_every_frame", streamingError < 1, "maxBottomGap=\(streamingError)")
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
        restore(id: "async-card", offset: 0)
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
        // A send returns to the end and its reply keeps the end in view. A
        // touch while it streams must never move the transcript back down,
        // wherever the reader was.
        func y(of id: String) -> CGFloat {
            guard let index = rows.firstIndex(where: { $0.id == id }),
                  let attributes = layout.layoutAttributesForItem(at: IndexPath(item: index, section: 0)) else { return .infinity }
            return attributes.frame.minY - collection.bounds.minY - collection.adjustedContentInset.top
        }
        func touch() {
            scrollViewWillBeginDragging(collection)
            scrollViewDidEndDragging(collection, willDecelerate: false)
        }
        func sendAndStream(_ name: String) async {
            let question = "user.\(name)", answer = "answer.\(name)"
            fixture.append(.user(id: question, messageId: name, text: "Send while \(name)", images: []))
            apply(question)
            await pause()
            let sentGap = distanceToEnd
            var lastOffset = collection.contentOffset.y, backward: CGFloat = 0
            let probe = TranscriptFrameProbe { [unowned self] in
                backward = max(backward, lastOffset - collection.contentOffset.y)
                lastOffset = collection.contentOffset.y
            }
            fixture.append(.assistantText(id: answer, messageId: name, text: "", streaming: true))
            for step in 1...30 {
                fixture[fixture.count - 1] = .assistantText(id: answer, messageId: name,
                    text: String(repeating: "Streaming paragraph with **bold text**.\n\n", count: step), streaming: true)
                apply(question)
                if step == 4 { touch() }
                try? await Task.sleep(for: .milliseconds(150))
            }
            await pause()
            probe.stop()
            check("send_stream_\(name)", abs(sentGap) < 1 && backward < 1 && nearBottom,
                  "sentGap=\(sentGap) maxBackward=\(backward) nearBottom=\(nearBottom)")
        }
        fixture = fixture0
        apply()
        showLatest()
        await pause()
        await sendAndStream("bottom")
        restore(id: "user.20", offset: 0)
        touch()
        await pause()
        await sendAndStream("up")
        // A turn that ends replaces the rows of its reply: the work folds into
        // one row and the answer takes the server's id. A reader inside the
        // reply must stay where they are.
        fixture.append(.user(id: "user.ended", messageId: "ended", text: "A question whose turn ends", images: []))
        apply("user.ended")
        await pause()
        fixture.append(.assistantText(id: "text.local.0", messageId: "local",
            text: String(repeating: "Work narrated while the tools ran.\n\n", count: 40), streaming: true))
        fixture.append(.assistantText(id: "text.local.1", messageId: "local",
            text: String(repeating: "The final answer, long enough to hold the reader.\n\n", count: 60), streaming: true))
        apply("user.ended")
        await pause()
        restore(id: "text.local.0", offset: -300)
        touch()
        await pause()
        let endedY = y(of: "user.ended")
        fixture.removeLast(2)
        fixture.append(.hint(id: "event.work.server", text: "Worked for 12s", isError: false))
        fixture.append(.assistantText(id: "text.server.1", messageId: "server",
            text: String(repeating: "The final answer, long enough to hold the reader.\n\n", count: 60), streaming: false))
        apply("user.ended")
        await pause()
        check("turn_end_keeps_reader", endedY.isFinite && abs(y(of: "user.ended") - endedY) < 1,
              "before=\(endedY) after=\(y(of: "user.ended"))")
        // Messages that arrive from elsewhere (a teammate, the next turn)
        // follow a reader at the end, however they got there, and never move
        // one who is not, however they left it.
        func arrive(_ name: String) {
            fixture.append(.user(id: "user.\(name)", messageId: name, text: "A message from a teammate", images: []))
            fixture.append(.assistantText(id: "answer.\(name)", messageId: "r\(name)",
                text: String(repeating: "An incoming reply that is longer than the screen.\n\n", count: 30), streaming: false))
            apply()
        }
        // A fling or a status-bar tap reaches the end without a drag ending there.
        collection.setContentOffset(CGPoint(x: 0, y: layout.collectionViewContentSize.height - collection.bounds.height + collection.adjustedContentInset.bottom), animated: true)
        await pause()
        arrive("at_end")
        await pause()
        check("incoming_at_end", nearBottom, "offset=\(collection.contentOffset.y) nearBottom=\(nearBottom)")
        // A light drag that stops a few points short of the end is reading.
        collection.contentOffset.y -= 20
        touch()
        let peeked = collection.contentOffset.y
        arrive("light_drag")
        await pause()
        check("incoming_after_light_drag", abs(collection.contentOffset.y - peeked) < 1,
              "before=\(peeked) after=\(collection.contentOffset.y)")
        collection.setContentOffset(CGPoint(x: 0, y: -collection.adjustedContentInset.top), animated: true)
        await pause()
        let readingY = y(of: "user.1")
        arrive("scrolled_up")
        await pause()
        check("incoming_keeps_reader", abs(y(of: "user.1") - readingY) < 1 && !nearBottom,
              "before=\(readingY) after=\(y(of: "user.1"))")
        // At the end, a short event row arrives — a join notice, or a message
        // another session or GitHub delivered — then the turn starts and
        // streams. The rows already on screen may only move up, never back.
        // The second run starts by removing the first run's rows while the
        // reader follows; that must leave the reader at the end too.
        let arrivals: [(String, ChatRow)] = [
            ("event_then_stream", .hint(id: "event.joined", text: "Yuanlin joined the session", isError: false)),
            ("agent_event_then_stream", .event(id: "user.github", event: .init(name: "GitHub", logo: "logo-github",
                text: "nuphos/nuphos#631 check_suite.completed\n\nAll checks passed."))),
        ]
        for (name, arrival) in arrivals {
            fixture = fixture0
            apply()
            showLatest()
            await pause()
            func screenY(_ id: String) -> CGFloat {
                guard let index = rows.firstIndex(where: { $0.id == id }),
                      let frame = layout.layoutAttributesForItem(at: IndexPath(item: index, section: 0))?.frame else { return .nan }
                return frame.minY - collection.contentOffset.y
            }
            var lastY = screenY("answer.39"), down: CGFloat = 0, frames = 0
            let eventProbe = TranscriptFrameProbe {
                let y = screenY("answer.39")
                if y.isFinite, lastY.isFinite { down = max(down, y - lastY) }
                lastY = y
                frames += 1
            }
            fixture.append(arrival)
            apply()
            try? await Task.sleep(for: .milliseconds(400))
            fixture.append(.activity(text: "Thinking…", live: true))
            apply()
            try? await Task.sleep(for: .milliseconds(400))
            fixture.insert(.assistantText(id: "answer.event", messageId: "event", text: "", streaming: true), at: fixture.count - 1)
            for step in 1...8 {
                fixture[fixture.count - 2] = .assistantText(id: "answer.event", messageId: "event",
                    text: String(repeating: "Streaming after an event row.\n\n", count: step), streaming: true)
                apply()
                try? await Task.sleep(for: .milliseconds(150))
            }
            await pause()
            eventProbe.stop()
            check(name, down < 1 && nearBottom, "maxDownward=\(down) frames=\(frames) nearBottom=\(nearBottom)")
        }
        // A rotation must move rows straight to their new layout. Animated,
        // each row cross-fades between two cells and its text stretches, so
        // rows draw over each other until the rotation ends.
        func animatedRows() -> Int {
            collection.subviews.compactMap { $0 as? TranscriptCell }.filter { cell in
                var layers = [cell.layer]
                while let layer = layers.popLast() {
                    if layer.animationKeys()?.isEmpty == false { return true }
                    layers += layer.sublayers ?? []
                }
                return false
            }.count
        }
        for (name, orientation) in [("rotate_landscape", UIInterfaceOrientationMask.landscapeRight), ("rotate_portrait", .portrait)] {
            let width = collection.bounds.width
            var worst = 0
            let rotationProbe = TranscriptFrameProbe { worst = max(worst, animatedRows()) }
            view.window?.windowScene?.requestGeometryUpdate(.iOS(interfaceOrientations: orientation))
            try? await Task.sleep(for: .seconds(1.5))
            rotationProbe.stop()
            check(name, collection.bounds.width != width && worst == 0,
                  "width=\(width)->\(collection.bounds.width) maxAnimatedRows=\(worst)")
        }
        check("suite_complete", true, "")
    }
    #endif
}

/// A rotation resizes the transcript inside the system's animation. Animated,
/// the collection view cross-fades each row between its old and new layout
/// and the drawn text stretches, so rows draw over each other for a moment.
/// While rotating, the whole subtree takes its new size at once instead.
private final class RotationLayoutView: UIView {
    var rotating = false
    override func layoutSubviews() {
        guard rotating else { return super.layoutSubviews() }
        UIView.performWithoutAnimation {
            super.layoutSubviews()
            for subview in subviews { subview.layoutIfNeeded() }
        }
    }
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

#if os(iOS)
import AVKit
import SwiftUI
import UniformTypeIdentifiers
import UIKit

/// Full-screen preview of a message's images and videos. Swiping sideways
/// steps through them and wraps at either end, a pinch zooms an image, and a
/// pull down closes it. Whichever way a drag starts decides which of those it is.
struct MediaPager: View {
    let urls: [URL]
    @State var current: URL
    /// Fetches a video's copy to its URL, for a page shown before it is on disk.
    var load: (URL) async throws -> Void = { _ in }
    @State private var pull: CGFloat = 0
    @State private var closing = false
    @Environment(\.dismiss) private var dismiss

    /// Whether the pager can show `url`: a video, or an image UIImage decodes.
    static func shows(_ url: URL) -> Bool {
        isVideo(url) || UIImage(contentsOfFile: url.path) != nil
    }

    fileprivate static func isVideo(_ url: URL) -> Bool {
        UTType(filenameExtension: url.pathExtension)?.conforms(to: .movie) == true
    }

    var body: some View {
        // The bar sits above the pages rather than over them: a SwiftUI
        // button drawn over the UIKit pager never gets its tap.
        VStack(spacing: 0) {
            HStack {
                Button("Done", systemImage: "xmark", action: close)
                Spacer()
                if urls.count > 1, let index = urls.firstIndex(of: current) {
                    Text(verbatim: "\(index + 1) / \(urls.count)").monospacedDigit()
                }
                Spacer()
                ShareLink(item: current) { Image(systemName: "square.and.arrow.up") }
            }
            .labelStyle(.iconOnly)
            .font(.body.weight(.medium))
            .foregroundStyle(.white)
            .padding(.horizontal, 20)
            .padding(.vertical, 8)
            .opacity(pull > 0 ? 0 : 1)
            Pages(urls: urls, current: $current, pull: $pull, load: load, close: close)
                .ignoresSafeArea(edges: [.horizontal, .bottom])
        }
        .background(Color.black.opacity(1 - min(pull / 300, 0.6)).ignoresSafeArea())
        .opacity(closing ? 0 : 1)
        .presentationBackground(.clear)
    }

    /// Fades out where it is; the cover's own slide down is skipped.
    private func close() {
        withAnimation(.easeOut(duration: 0.2)) {
            closing = true
        } completion: {
            var transaction = Transaction()
            transaction.disablesAnimations = true
            withTransaction(transaction) { dismiss() }
        }
    }
}

private struct Pages: UIViewControllerRepresentable {
    let urls: [URL]
    @Binding var current: URL
    @Binding var pull: CGFloat
    let load: (URL) async throws -> Void
    let close: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIViewController(context: Context) -> UIPageViewController {
        let pager = UIPageViewController(transitionStyle: .scroll, navigationOrientation: .horizontal, options: [.interPageSpacing: 16])
        pager.dataSource = context.coordinator
        pager.delegate = context.coordinator
        pager.setViewControllers([context.coordinator.page(current)], direction: .forward, animated: false)
        // One touch, one axis: the paging scroll view waits for the pull to
        // decline, and the pull only takes drags that start mostly downward.
        let pull = UIPanGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.pull(_:)))
        pull.delegate = context.coordinator
        pager.view.addGestureRecognizer(pull)
        let scrolls = pager.view.subviews.compactMap { $0 as? UIScrollView }
        assert(!scrolls.isEmpty, "UIPageViewController no longer exposes its paging scroll view")
        for scroll in scrolls { scroll.panGestureRecognizer.require(toFail: pull) }
        return pager
    }

    func updateUIViewController(_ pager: UIPageViewController, context: Context) {
        context.coordinator.parent = self
    }

    @MainActor
    final class Coordinator: NSObject, UIPageViewControllerDataSource, UIPageViewControllerDelegate, UIGestureRecognizerDelegate {
        var parent: Pages
        /// Each video's fetch in flight, shared by its pages: one swiped away
        /// and back while the file is still coming waits for the same fetch.
        private var loads: [URL: Task<Void, Error>] = [:]
        init(_ parent: Pages) { self.parent = parent }

        func page(_ url: URL) -> UIViewController & Page {
            MediaPager.isVideo(url) ? PlayerPage(url: url, load: load) : ZoomPage(url: url)
        }

        private func load(_ url: URL) async throws {
            let task = loads[url] ?? Task { try await parent.load(url) }
            loads[url] = task
            // Once done it is forgotten, so a retry, or a file trimmed since,
            // fetches anew.
            defer { if loads[url] == task { loads[url] = nil } }
            try await task.value
        }

        func gestureRecognizerShouldBegin(_ recognizer: UIGestureRecognizer) -> Bool {
            guard let pan = recognizer as? UIPanGestureRecognizer,
                  let page = (pan.view?.next as? UIPageViewController)?.viewControllers?.first,
                  (page as? ZoomPage)?.isZoomed != true else { return false }
            let velocity = pan.velocity(in: pan.view)
            return velocity.y > abs(velocity.x)
        }

        /// The image follows the finger and shrinks a little; letting go far
        /// enough down, or with a flick, closes the preview.
        @objc func pull(_ pan: UIPanGestureRecognizer) {
            guard let page = (pan.view?.next as? UIPageViewController)?.viewControllers?.first?.view else { return }
            let offset = pan.translation(in: pan.view)
            switch pan.state {
            case .changed:
                let scale = 1 - min(max(offset.y, 0) / 300, 1) * 0.3
                page.transform = CGAffineTransform(translationX: offset.x, y: offset.y).scaledBy(x: scale, y: scale)
                parent.pull = max(offset.y, 0)
            case .ended where offset.y > 100 || pan.velocity(in: pan.view).y > 800:
                parent.close()
            case .ended, .cancelled:
                UIView.animate(withDuration: 0.25) { page.transform = .identity }
                withAnimation(.snappy(duration: 0.25)) { parent.pull = 0 }
            default: break
            }
        }

        /// The neighbour `step` away, wrapping past either end.
        private func neighbour(of controller: UIViewController, step: Int) -> UIViewController? {
            let urls = parent.urls
            guard urls.count > 1, let index = urls.firstIndex(of: (controller as! Page).url) else { return nil }
            return page(urls[(index + step + urls.count) % urls.count])
        }

        func pageViewController(_ pager: UIPageViewController, viewControllerBefore controller: UIViewController) -> UIViewController? {
            neighbour(of: controller, step: -1)
        }

        func pageViewController(_ pager: UIPageViewController, viewControllerAfter controller: UIViewController) -> UIViewController? {
            neighbour(of: controller, step: 1)
        }

        func pageViewController(_ pager: UIPageViewController, didFinishAnimating finished: Bool, previousViewControllers: [UIViewController], transitionCompleted completed: Bool) {
            if let page = pager.viewControllers?.first as? Page { parent.current = page.url }
        }
    }
}

private protocol Page: UIViewController {
    var url: URL { get }
}

/// One image in a scroll view, for the pinch. Until it is zoomed there is
/// nothing to pan, so its own pan stays out of the way of paging and the pull.
private final class ZoomPage: UIViewController, Page, UIScrollViewDelegate {
    let url: URL
    private let scroll = UIScrollView()
    private let image = UIImageView()

    var isZoomed: Bool { scroll.zoomScale > 1 }

    init(url: URL) {
        self.url = url
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError() }

    override func viewDidLoad() {
        super.viewDidLoad()
        scroll.frame = view.bounds
        scroll.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        scroll.delegate = self
        scroll.maximumZoomScale = 4
        scroll.panGestureRecognizer.isEnabled = false
        scroll.showsVerticalScrollIndicator = false
        scroll.showsHorizontalScrollIndicator = false
        scroll.contentInsetAdjustmentBehavior = .never
        image.image = UIImage(contentsOfFile: url.path)
        image.contentMode = .scaleAspectFit
        image.frame = scroll.bounds
        image.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        image.accessibilityIdentifier = url.lastPathComponent
        scroll.addSubview(image)
        view.addSubview(scroll)
    }

    func viewForZooming(in scrollView: UIScrollView) -> UIView? { image }

    func scrollViewDidZoom(_ scrollView: UIScrollView) {
        scrollView.panGestureRecognizer.isEnabled = isZoomed
    }
}
/// One video with the system's playback controls; it pauses once swiped away.
/// A video not yet on disk is fetched when its page shows, behind a spinner;
/// if that fails, the page says so and offers to try again.
private final class PlayerPage: UIViewController, Page {
    let url: URL
    private let load: (URL) async throws -> Void
    private let player = AVPlayerViewController()

    init(url: URL, load: @escaping (URL) async throws -> Void) {
        self.url = url
        self.load = load
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError() }

    override func viewDidLoad() {
        super.viewDidLoad()
        player.view.backgroundColor = .clear
        player.view.frame = view.bounds
        player.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        player.view.accessibilityIdentifier = url.lastPathComponent
        addChild(player)
        view.addSubview(player.view)
        player.didMove(toParent: self)
        Task { await show() }
    }

    private func show() async {
        if !FileManager.default.fileExists(atPath: url.path) {
            let spinner = UIActivityIndicatorView(style: .large)
            spinner.color = .white
            centre(spinner)
            spinner.startAnimating()
            defer { spinner.removeFromSuperview() }
            do {
                try await load(url)
            } catch {
                var retry = UIButton.Configuration.plain()
                retry.title = String(localized: "Couldn't load the video. Try again.")
                retry.image = UIImage(systemName: "arrow.clockwise")
                retry.imagePlacement = .top
                retry.imagePadding = 8
                retry.baseForegroundColor = .white
                let button = UIButton(configuration: retry, primaryAction: UIAction { [weak self] action in
                    (action.sender as? UIView)?.removeFromSuperview()
                    Task { await self?.show() }
                })
                button.sizeToFit()
                centre(button)
                return
            }
        }
        player.player = AVPlayer(url: url)
    }

    private func centre(_ subview: UIView) {
        subview.center = CGPoint(x: view.bounds.midX, y: view.bounds.midY)
        subview.autoresizingMask = [.flexibleTopMargin, .flexibleBottomMargin, .flexibleLeftMargin, .flexibleRightMargin]
        view.addSubview(subview)
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        player.player?.pause()
    }
}
#endif

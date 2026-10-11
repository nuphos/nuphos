#if os(iOS)
import SwiftUI
import UIKit

/// Full-screen image preview. Swiping sideways steps through the group and
/// wraps at either end, a pinch zooms, and a pull down closes it. Whichever
/// way a drag starts decides which of those it is.
struct ImagePager: View {
    let urls: [URL]
    @State var current: URL
    @State private var pull: CGFloat = 0
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        Pages(urls: urls, current: $current, pull: $pull, close: { dismiss() })
            .ignoresSafeArea()
            .background(Color.black.opacity(1 - min(pull / 300, 0.6)).ignoresSafeArea())
            .overlay(alignment: .top) {
                HStack {
                    Button("Done", systemImage: "xmark") { dismiss() }
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
                .padding(.top, 8)
                .opacity(pull > 0 ? 0 : 1)
            }
            .presentationBackground(.clear)
    }
}

private struct Pages: UIViewControllerRepresentable {
    let urls: [URL]
    @Binding var current: URL
    @Binding var pull: CGFloat
    let close: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIViewController(context: Context) -> UIPageViewController {
        let pager = UIPageViewController(transitionStyle: .scroll, navigationOrientation: .horizontal, options: [.interPageSpacing: 16])
        pager.dataSource = context.coordinator
        pager.delegate = context.coordinator
        pager.setViewControllers([ZoomPage(url: current)], direction: .forward, animated: false)
        // One touch, one axis: the paging scroll view waits for the pull to
        // decline, and the pull only takes drags that start mostly downward.
        let pull = UIPanGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.pull(_:)))
        pull.delegate = context.coordinator
        pager.view.addGestureRecognizer(pull)
        for case let scroll as UIScrollView in pager.view.subviews { scroll.panGestureRecognizer.require(toFail: pull) }
        return pager
    }

    func updateUIViewController(_ pager: UIPageViewController, context: Context) {
        context.coordinator.parent = self
    }

    final class Coordinator: NSObject, UIPageViewControllerDataSource, UIPageViewControllerDelegate, UIGestureRecognizerDelegate {
        var parent: Pages
        init(_ parent: Pages) { self.parent = parent }

        func gestureRecognizerShouldBegin(_ recognizer: UIGestureRecognizer) -> Bool {
            guard let pan = recognizer as? UIPanGestureRecognizer,
                  let page = (pan.view?.next as? UIPageViewController)?.viewControllers?.first as? ZoomPage,
                  !page.isZoomed else { return false }
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
            guard urls.count > 1, let index = urls.firstIndex(of: (controller as! ZoomPage).url) else { return nil }
            return ZoomPage(url: urls[(index + step + urls.count) % urls.count])
        }

        func pageViewController(_ pager: UIPageViewController, viewControllerBefore controller: UIViewController) -> UIViewController? {
            neighbour(of: controller, step: -1)
        }

        func pageViewController(_ pager: UIPageViewController, viewControllerAfter controller: UIViewController) -> UIViewController? {
            neighbour(of: controller, step: 1)
        }

        func pageViewController(_ pager: UIPageViewController, didFinishAnimating finished: Bool, previousViewControllers: [UIViewController], transitionCompleted completed: Bool) {
            if let page = pager.viewControllers?.first as? ZoomPage { parent.current = page.url }
        }
    }
}

/// One image in a scroll view, for the pinch. Until it is zoomed there is
/// nothing to pan, so its own pan stays out of the way of paging and the pull.
private final class ZoomPage: UIViewController, UIScrollViewDelegate {
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
#endif

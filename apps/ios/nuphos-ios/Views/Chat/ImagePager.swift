#if os(iOS)
import SwiftUI
import UIKit

/// Full-screen image preview. Swiping sideways steps through the group and
/// wraps at either end, a pinch zooms, and a pull down closes it.
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
                    Button("Close", systemImage: "xmark") { dismiss() }
                    Spacer()
                    if urls.count > 1, let index = urls.firstIndex(of: current) {
                        Text("\(index + 1) / \(urls.count)").monospacedDigit()
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
        pager.setViewControllers([context.coordinator.page(current)], direction: .forward, animated: false)
        return pager
    }

    func updateUIViewController(_ pager: UIPageViewController, context: Context) {
        context.coordinator.parent = self
    }

    final class Coordinator: NSObject, UIPageViewControllerDataSource, UIPageViewControllerDelegate {
        var parent: Pages
        init(_ parent: Pages) { self.parent = parent }

        func page(_ url: URL) -> ZoomPage {
            ZoomPage(url: url, pull: { [weak self] in self?.parent.pull = $0 }, close: { [weak self] in self?.parent.close() })
        }

        /// The neighbour `step` away, wrapping past either end.
        private func neighbour(of controller: UIViewController, step: Int) -> UIViewController? {
            let urls = parent.urls
            guard urls.count > 1, let index = urls.firstIndex(of: (controller as! ZoomPage).url) else { return nil }
            return page(urls[(index + step + urls.count) % urls.count])
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

/// One image in a scroll view: the scroll view's own zoom and vertical bounce
/// give the pinch and the finger-following pull.
private final class ZoomPage: UIViewController, UIScrollViewDelegate {
    let url: URL
    private let pull: (CGFloat) -> Void
    private let close: () -> Void
    private let scroll = UIScrollView()
    private let image = UIImageView()

    init(url: URL, pull: @escaping (CGFloat) -> Void, close: @escaping () -> Void) {
        self.url = url
        self.pull = pull
        self.close = close
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError() }

    override func viewDidLoad() {
        super.viewDidLoad()
        scroll.frame = view.bounds
        scroll.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        scroll.delegate = self
        scroll.maximumZoomScale = 4
        scroll.alwaysBounceVertical = true
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

    func scrollViewDidScroll(_ scrollView: UIScrollView) {
        if scrollView.zoomScale == 1 { pull(max(0, -scrollView.contentOffset.y)) }
    }

    func scrollViewWillEndDragging(_ scrollView: UIScrollView, withVelocity velocity: CGPoint, targetContentOffset: UnsafeMutablePointer<CGPoint>) {
        if scrollView.zoomScale == 1, scrollView.contentOffset.y < -80 || velocity.y < -1 { close() }
    }
}
#endif

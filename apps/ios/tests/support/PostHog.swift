// Recording SDK boundary for AnalyticsTests. No networking or persistence.
// The simulator build separately checks this contract against the real SDK.
public final class PostHogConfig {
    public var captureApplicationLifecycleEvents = true
    public var captureScreenViews = true
    public var enableSwizzling = true
    public var preloadFeatureFlags = true
    public var surveys = true
    public init(projectToken: String, host: String) {}
}

public final class PostHogSDK {
    public static let shared = PostHogSDK()
    public struct Event {
        public let name: String
        public let user: String?
        public let properties: [String: Any]
    }
    public private(set) var events: [Event] = []
    public private(set) var configs: [PostHogConfig] = []
    public private(set) var resets = 0
    private var user: String?
    private var properties: [String: Any] = [:]
    public func setup(_ config: PostHogConfig) { configs.append(config) }
    public func reset() { user = nil; properties = [:]; resets += 1 }
    public func register(_ properties: [String: Any]) { self.properties.merge(properties) { _, new in new } }
    public func identify(_ id: String) { user = id }
    public func capture(_ event: String, properties: [String: Any]? = nil) {
        events.append(Event(name: event, user: user, properties: self.properties.merging(properties ?? [:]) { _, new in new }))
    }
    public func screen(_ name: String, properties: [String: Any]? = nil) {
        capture("$screen", properties: (properties ?? [:]).merging(["$screen_name": name]) { _, new in new })
    }
    public func flush() {}
}

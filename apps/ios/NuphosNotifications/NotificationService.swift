import Intents
import UIKit
import UserNotifications

/// Uses only the original Bot identity supplied by the server. Legacy and Task
/// payloads stay ordinary notifications; the system keeps its app-icon presentation.
final class NotificationService: UNNotificationServiceExtension {
    override func didReceive(
        _ request: UNNotificationRequest, withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
    ) {
        contentHandler(Self.fromAgent(request.content) ?? request.content)
    }

    private static func fromAgent(_ content: UNNotificationContent) -> UNNotificationContent? {
        guard BotAvatars.enabled,
              let sessionId = content.userInfo["sessionId"] as? String, !sessionId.isEmpty,
              let identity = BotAvatars.notificationIdentity(content.userInfo),
              let asset = BotAvatars.asset(named: identity.avatar),
              let avatar = UIImage(named: asset) else { return nil }
        // INImage needs bitmap data; the avatars are vector assets.
        let size = CGSize(width: 120, height: 120)
        let png = UIGraphicsImageRenderer(size: size).pngData { context in
            avatar.draw(in: CGRect(origin: .zero, size: size))
            if let name = BotAvatars.runtimeLogo(identity.provider), let logo = UIImage(named: name) {
                // Inset inside the circular system avatar mask, at its lower-right edge.
                let disc = CGRect(x: 74, y: 74, width: 32, height: 32)
                UIColor.systemBackground.setFill()
                context.cgContext.fillEllipse(in: disc)
                let mark = identity.provider == "claude-code" ? logo : logo.withTintColor(.label, renderingMode: .alwaysOriginal)
                mark.draw(in: disc.insetBy(dx: 3, dy: 3))
            }
        }
        let agent = INPerson(
            personHandle: INPersonHandle(value: sessionId, type: .unknown), nameComponents: nil,
            displayName: content.title, image: INImage(imageData: png), contactIdentifier: nil, customIdentifier: sessionId)
        let intent = INSendMessageIntent(
            recipients: nil, outgoingMessageType: .outgoingMessageText, content: content.body, speakableGroupName: nil,
            conversationIdentifier: sessionId, serviceName: nil, sender: agent, attachments: nil)
        let interaction = INInteraction(intent: intent, response: nil)
        interaction.direction = .incoming
        interaction.donate(completion: nil)
        return try? content.updating(from: intent)
    }
}

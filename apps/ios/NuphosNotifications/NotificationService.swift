import Intents
import UIKit
import UserNotifications

/// Shows a session push as a message from its Agent: the bot avatar large,
/// with the app icon in its corner. Anything missing delivers the push as sent.
final class NotificationService: UNNotificationServiceExtension {
    override func didReceive(
        _ request: UNNotificationRequest, withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
    ) {
        contentHandler(Self.fromAgent(request.content) ?? request.content)
    }

    private static func fromAgent(_ content: UNNotificationContent) -> UNNotificationContent? {
        guard BotAvatars.enabled,
              let sessionId = content.userInfo["sessionId"] as? String, !sessionId.isEmpty,
              let avatar = UIImage(named: BotAvatars.asset(for: sessionId)) else { return nil }
        // INImage needs bitmap data; the avatars are vector assets.
        let size = CGSize(width: 120, height: 120)
        let png = UIGraphicsImageRenderer(size: size).pngData { _ in avatar.draw(in: CGRect(origin: .zero, size: size)) }
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

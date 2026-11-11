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
              let png = BotAvatars.notificationPNG(avatar: identity.avatar, provider: identity.provider) else { return nil }
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

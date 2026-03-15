import Foundation
import UserNotifications
import UIKit

/// Manages push notification registration and handling.
@MainActor
class PushNotificationManager: NSObject, ObservableObject {
    static let shared = PushNotificationManager()

    @Published var isRegistered = false
    @Published var deviceToken: String?

    private let deviceTokenService = DeviceTokenService.shared

    private override init() {
        super.init()
        UNUserNotificationCenter.current().delegate = self
    }

    /// Request notification permissions and register for remote notifications.
    func requestAuthorization() async -> Bool {
        let center = UNUserNotificationCenter.current()

        do {
            let granted = try await center.requestAuthorization(options: [.alert, .sound, .badge])

            if granted {
                await registerForRemoteNotifications()
            }

            return granted
        } catch {
            print("Failed to request notification authorization: \(error)")
            return false
        }
    }

    /// Register for remote notifications.
    func registerForRemoteNotifications() async {
        await UIApplication.shared.registerForRemoteNotifications()
    }

    /// Handle successful device token registration.
    func didRegisterForRemoteNotifications(deviceToken: Data) {
        let tokenString = deviceToken.map { String(format: "%02.2hhx", $0) }.joined()
        self.deviceToken = tokenString

        print("APNs device token: \(tokenString)")

        // Register with backend
        Task {
            do {
                try await deviceTokenService.registerToken(token: tokenString)
                isRegistered = true
            } catch {
                print("Failed to register device token with backend: \(error)")
            }
        }
    }

    /// Handle failed device token registration.
    func didFailToRegisterForRemoteNotifications(error: Error) {
        print("Failed to register for remote notifications: \(error)")
    }

    /// Unregister device token when user logs out.
    func unregisterToken() async {
        do {
            try await deviceTokenService.unregisterToken()
            isRegistered = false
            deviceToken = nil
        } catch {
            print("Failed to unregister device token: \(error)")
        }
    }
}

// MARK: - UNUserNotificationCenterDelegate

extension PushNotificationManager: UNUserNotificationCenterDelegate {

    /// Handle notification when app is in foreground.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        let userInfo = notification.request.content.userInfo

        // Log notification data
        print("Received notification in foreground: \(userInfo)")

        // Show banner and play sound even when app is in foreground
        completionHandler([.banner, .sound, .badge])
    }

    /// Handle notification tap.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let userInfo = response.notification.request.content.userInfo

        // Handle deep link
        if let deepLink = NotificationDeepLinkHandler.parseDeepLink(from: userInfo) {
            NotificationCenter.default.post(
                name: .notificationDeepLink,
                object: nil,
                userInfo: ["deepLink": deepLink]
            )
        }

        completionHandler()
    }
}

// MARK: - Notification Names

extension Notification.Name {
    static let notificationDeepLink = Notification.Name("notificationDeepLink")
}

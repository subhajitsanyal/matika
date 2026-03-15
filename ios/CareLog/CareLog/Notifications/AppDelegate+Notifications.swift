import Foundation
import UIKit
import UserNotifications

/// AppDelegate extension for handling push notification registration.
extension AppDelegate {

    /// Configure push notifications on app launch.
    func configureNotifications(_ application: UIApplication) {
        // Set up notification center delegate
        UNUserNotificationCenter.current().delegate = PushNotificationManager.shared

        // Check current authorization status
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            if settings.authorizationStatus == .authorized {
                DispatchQueue.main.async {
                    application.registerForRemoteNotifications()
                }
            }
        }
    }

    /// Handle successful registration for remote notifications.
    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        Task { @MainActor in
            PushNotificationManager.shared.didRegisterForRemoteNotifications(deviceToken: deviceToken)
        }
    }

    /// Handle failed registration for remote notifications.
    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        Task { @MainActor in
            PushNotificationManager.shared.didFailToRegisterForRemoteNotifications(error: error)
        }
    }

    /// Handle remote notification received while app is in background.
    func application(
        _ application: UIApplication,
        didReceiveRemoteNotification userInfo: [AnyHashable: Any],
        fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void
    ) {
        // Process silent notification if needed
        print("Received remote notification: \(userInfo)")

        // Handle any background data processing here
        completionHandler(.newData)
    }
}

// MARK: - AppDelegate Class

/// Main AppDelegate for handling application lifecycle and push notifications.
class AppDelegate: NSObject, UIApplicationDelegate {

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {

        // Configure push notifications
        configureNotifications(application)

        // Check if app was launched from notification
        if let notificationInfo = launchOptions?[.remoteNotification] as? [AnyHashable: Any] {
            handleNotificationLaunch(userInfo: notificationInfo)
        }

        return true
    }

    /// Handle app launch from notification.
    private func handleNotificationLaunch(userInfo: [AnyHashable: Any]) {
        if let deepLink = NotificationDeepLinkHandler.parseDeepLink(from: userInfo) {
            // Post notification for deep link handling
            // This will be picked up by the navigation system
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                NotificationCenter.default.post(
                    name: .notificationDeepLink,
                    object: nil,
                    userInfo: ["deepLink": deepLink]
                )
            }
        }
    }
}

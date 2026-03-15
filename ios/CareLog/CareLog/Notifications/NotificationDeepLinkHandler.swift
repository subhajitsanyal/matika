import Foundation

/// Handles deep linking from push notifications.
struct NotificationDeepLinkHandler {

    /// Deep link data extracted from notification.
    struct DeepLinkData {
        let type: NotificationType
        let patientId: String?
        let vitalType: String?
        let alertId: String?
    }

    /// Types of notifications.
    enum NotificationType: String {
        case thresholdBreach = "THRESHOLD_BREACH"
        case reminderLapse = "REMINDER_LAPSE"
        case patientReminder = "PATIENT_REMINDER"
        case system = "SYSTEM"
    }

    /// Navigation destinations for deep linking.
    enum NavigationDestination {
        case dashboard
        case alertInbox
        case bloodPressureLog
        case glucoseLog
        case temperatureLog
        case weightLog
        case pulseLog
        case spo2Log
    }

    /// Parse deep link data from notification user info.
    static func parseDeepLink(from userInfo: [AnyHashable: Any]) -> DeepLinkData? {
        // Try to get data from APNs payload
        let data: [String: Any]
        if let apsData = userInfo["data"] as? [String: Any] {
            data = apsData
        } else {
            data = userInfo as? [String: Any] ?? [:]
        }

        guard let typeString = data["type"] as? String,
              let type = NotificationType(rawValue: typeString) else {
            return nil
        }

        return DeepLinkData(
            type: type,
            patientId: data["patientId"] as? String,
            vitalType: data["vitalType"] as? String,
            alertId: data["alertId"] as? String
        )
    }

    /// Determine the navigation destination based on deep link type.
    static func getNavigationDestination(for deepLink: DeepLinkData) -> NavigationDestination {
        switch deepLink.type {
        case .thresholdBreach, .reminderLapse:
            return .alertInbox

        case .patientReminder:
            // Navigate to the appropriate vital logging screen
            switch deepLink.vitalType {
            case "BLOOD_PRESSURE":
                return .bloodPressureLog
            case "GLUCOSE":
                return .glucoseLog
            case "TEMPERATURE":
                return .temperatureLog
            case "WEIGHT":
                return .weightLog
            case "PULSE":
                return .pulseLog
            case "SPO2":
                return .spo2Log
            default:
                return .dashboard
            }

        case .system:
            return .dashboard
        }
    }
}

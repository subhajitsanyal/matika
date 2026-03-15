import Foundation
import SwiftUI

/// ViewModel for the Alert Inbox view.
@MainActor
class AlertInboxViewModel: ObservableObject {
    @Published var isLoading = false
    @Published var alerts: [Alert] = []
    @Published var unreadCount: Int = 0
    @Published var showUnreadOnly = false
    @Published var error: String?

    private let apiService = RelativeApiService.shared
    private let authService = AuthService.shared
    private var patientId: String?

    func loadAlerts() {
        Task {
            await fetchAlerts()
        }
    }

    func refreshAlerts() async {
        await fetchAlerts()
    }

    private func fetchAlerts() async {
        guard !isLoading else { return }

        isLoading = true
        error = nil

        do {
            guard let user = authService.currentUser,
                  let linkedPatientId = user.linkedPatientId else {
                error = "No patient linked"
                isLoading = false
                return
            }

            patientId = linkedPatientId
            let fetchedAlerts = try await apiService.getAlerts(
                patientId: linkedPatientId,
                unreadOnly: showUnreadOnly
            )

            alerts = fetchedAlerts.sorted { $0.timestamp > $1.timestamp }
            unreadCount = fetchedAlerts.filter { !$0.read }.count
        } catch {
            self.error = error.localizedDescription
        }

        isLoading = false
    }

    func toggleFilter() {
        showUnreadOnly.toggle()
        loadAlerts()
    }

    func markAsRead(alertId: String) {
        Task {
            await markAlertAsRead(alertId: alertId)
        }
    }

    private func markAlertAsRead(alertId: String) async {
        do {
            try await apiService.markAlertAsRead(alertId: alertId)

            // Update local state
            if let index = alerts.firstIndex(where: { $0.id == alertId }) {
                var updatedAlert = alerts[index]
                updatedAlert.read = true
                alerts[index] = updatedAlert
                unreadCount = alerts.filter { !$0.read }.count
            }
        } catch {
            // Silently fail, user can retry
        }
    }

    func markAllAsRead() {
        Task {
            await markAllAlertsAsRead()
        }
    }

    private func markAllAlertsAsRead() async {
        let unreadAlerts = alerts.filter { !$0.read }

        for alert in unreadAlerts {
            do {
                try await apiService.markAlertAsRead(alertId: alert.id)
            } catch {
                // Continue with next alert
            }
        }

        // Update local state
        alerts = alerts.map { alert in
            var updatedAlert = alert
            updatedAlert.read = true
            return updatedAlert
        }
        unreadCount = 0
    }

    func deleteAlert(alertId: String) {
        // Optimistically remove from list
        alerts.removeAll { $0.id == alertId }
        unreadCount = alerts.filter { !$0.read }.count

        // Note: Would call delete API here when implemented
    }
}

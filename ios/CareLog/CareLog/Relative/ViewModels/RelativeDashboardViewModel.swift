import Foundation
import SwiftUI

/// ViewModel for the Relative Dashboard.
@MainActor
class RelativeDashboardViewModel: ObservableObject {
    @Published var isLoading = false
    @Published var patientSummary: PatientSummary?
    @Published var error: String?
    @Published var unreadAlertCount: Int = 0

    private let apiService = RelativeApiService.shared
    private let authService = AuthService.shared

    func loadPatientSummary() async {
        guard !isLoading else { return }

        isLoading = true
        error = nil

        do {
            guard let user = authService.currentUser,
                  let patientId = user.linkedPatientId else {
                error = "No patient linked to this account"
                isLoading = false
                return
            }

            let summary = try await apiService.getPatientSummary(patientId: patientId)
            patientSummary = summary
            unreadAlertCount = summary.unreadAlertCount
        } catch {
            self.error = error.localizedDescription
        }

        isLoading = false
    }

    func refresh() async {
        await loadPatientSummary()
    }
}

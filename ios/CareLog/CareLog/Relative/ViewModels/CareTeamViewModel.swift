import Foundation
import SwiftUI

/// ViewModel for the Care Team view.
@MainActor
class CareTeamViewModel: ObservableObject {
    @Published var isLoading = false
    @Published var careTeam: CareTeam?
    @Published var error: String?
    @Published var inviteSuccess = false

    private let apiService = RelativeApiService.shared
    private let authService = AuthService.shared
    private var patientId: String?

    func loadCareTeam() {
        Task {
            await fetchCareTeam()
        }
    }

    private func fetchCareTeam() async {
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
            let team = try await apiService.getCareTeam(patientId: linkedPatientId)
            careTeam = team
        } catch {
            self.error = error.localizedDescription
        }

        isLoading = false
    }

    func sendInvite(email: String, name: String, role: String) {
        Task {
            await sendInviteAsync(email: email, name: name, role: role)
        }
    }

    private func sendInviteAsync(email: String, name: String, role: String) async {
        guard let patientId = patientId else { return }

        do {
            if role == "attendant" {
                try await apiService.inviteAttendant(patientId: patientId, email: email, name: name)
            } else if role == "doctor" {
                try await apiService.inviteDoctor(patientId: patientId, email: email)
            }

            inviteSuccess = true

            // Hide success message after delay
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            inviteSuccess = false

            // Refresh care team
            await fetchCareTeam()
        } catch {
            self.error = error.localizedDescription
        }
    }

    func resendInvite(id: String) {
        // Implementation would call API to resend invite
    }

    func cancelInvite(id: String) {
        // Implementation would call API to cancel invite
        // Then refresh care team
        loadCareTeam()
    }
}

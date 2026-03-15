import Foundation
import SwiftUI

/// ViewModel for the Threshold Configuration view.
@MainActor
class ThresholdConfigViewModel: ObservableObject {
    @Published var isLoading = false
    @Published var thresholds: [VitalThreshold] = []
    @Published var error: String?
    @Published var showSuccess = false

    private let apiService = RelativeApiService.shared
    private let authService = AuthService.shared
    private var patientId: String?

    func loadThresholds() {
        Task {
            await fetchThresholds()
        }
    }

    private func fetchThresholds() async {
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
            let fetchedThresholds = try await apiService.getThresholds(patientId: linkedPatientId)
            thresholds = fetchedThresholds
        } catch {
            self.error = error.localizedDescription
        }

        isLoading = false
    }

    func updateThreshold(vitalType: VitalTypeAPI, minValue: Double?, maxValue: Double?) {
        Task {
            await saveThreshold(vitalType: vitalType, minValue: minValue, maxValue: maxValue)
        }
    }

    private func saveThreshold(vitalType: VitalTypeAPI, minValue: Double?, maxValue: Double?) async {
        guard let patientId = patientId else { return }

        do {
            try await apiService.updateThreshold(
                patientId: patientId,
                vitalType: vitalType,
                minValue: minValue,
                maxValue: maxValue
            )

            showSuccess = true

            // Hide success message after delay
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            showSuccess = false

            // Refresh thresholds
            await fetchThresholds()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

import Foundation
import SwiftUI

/// ViewModel for the Trends view.
@MainActor
class TrendsViewModel: ObservableObject {
    @Published var isLoading = false
    @Published var selectedDateRange: DateRange = .week
    @Published var selectedVitalType: VitalTypeAPI = .bloodPressure
    @Published var observations: [VitalObservation] = []
    @Published var threshold: VitalThreshold?
    @Published var error: String?

    private let apiService = RelativeApiService.shared
    private let authService = AuthService.shared

    func loadData() {
        Task {
            await fetchData()
        }
    }

    private func fetchData() async {
        guard !isLoading else { return }

        isLoading = true
        error = nil

        do {
            guard let user = authService.currentUser,
                  let patientId = user.linkedPatientId else {
                error = "No patient linked"
                isLoading = false
                return
            }

            let endDate = Date()
            let startDate = Calendar.current.date(
                byAdding: .day,
                value: -selectedDateRange.days,
                to: endDate
            )!

            // Fetch observations
            let fetchedObservations = try await apiService.getObservations(
                patientId: patientId,
                vitalType: selectedVitalType,
                startDate: startDate,
                endDate: endDate
            )

            // Fetch thresholds
            let thresholds = try await apiService.getThresholds(patientId: patientId)
            let matchingThreshold = thresholds.first { $0.vitalType == selectedVitalType }

            observations = fetchedObservations.sorted { $0.timestamp < $1.timestamp }
            threshold = matchingThreshold
        } catch {
            self.error = error.localizedDescription
        }

        isLoading = false
    }
}

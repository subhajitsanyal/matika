import Foundation
import SwiftUI

/// Model for reminder configuration.
struct ReminderConfigModel: Identifiable {
    let id: String
    let vitalType: VitalTypeAPI
    var windowHours: Int
    var gracePeriodMinutes: Int
    var enabled: Bool
    var updatedAt: Date?

    init(vitalType: VitalTypeAPI, windowHours: Int, gracePeriodMinutes: Int, enabled: Bool, updatedAt: Date? = nil) {
        self.id = vitalType.rawValue
        self.vitalType = vitalType
        self.windowHours = windowHours
        self.gracePeriodMinutes = gracePeriodMinutes
        self.enabled = enabled
        self.updatedAt = updatedAt
    }
}

/// ViewModel for the Reminder Configuration view.
@MainActor
class ReminderConfigViewModel: ObservableObject {
    @Published var isLoading = false
    @Published var reminders: [ReminderConfigModel] = []
    @Published var error: String?
    @Published var showSuccess = false

    private let apiService = RelativeApiService.shared
    private let authService = AuthService.shared
    private var patientId: String?

    // Default reminder configurations
    private let defaultReminders: [VitalTypeAPI: (windowHours: Int, gracePeriod: Int)] = [
        .bloodPressure: (24, 60),
        .glucose: (8, 30),
        .temperature: (12, 60),
        .weight: (168, 120),
        .pulse: (24, 60),
        .spo2: (24, 60)
    ]

    func loadReminders() {
        Task {
            await fetchReminders()
        }
    }

    private func fetchReminders() async {
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
            let fetchedReminders = try await apiService.getReminderConfigs(patientId: linkedPatientId)
            reminders = fetchedReminders
        } catch {
            // If API fails, use defaults
            reminders = VitalTypeAPI.allCases.map { vitalType in
                let defaults = defaultReminders[vitalType] ?? (24, 60)
                return ReminderConfigModel(
                    vitalType: vitalType,
                    windowHours: defaults.windowHours,
                    gracePeriodMinutes: defaults.gracePeriod,
                    enabled: true
                )
            }
            self.error = nil // Don't show error for defaults
        }

        isLoading = false
    }

    func updateReminder(
        vitalType: VitalTypeAPI,
        windowHours: Int,
        gracePeriodMinutes: Int,
        enabled: Bool
    ) {
        Task {
            await saveReminder(
                vitalType: vitalType,
                windowHours: windowHours,
                gracePeriodMinutes: gracePeriodMinutes,
                enabled: enabled
            )
        }
    }

    private func saveReminder(
        vitalType: VitalTypeAPI,
        windowHours: Int,
        gracePeriodMinutes: Int,
        enabled: Bool
    ) async {
        guard let patientId = patientId else { return }

        do {
            try await apiService.updateReminderConfig(
                patientId: patientId,
                vitalType: vitalType,
                windowHours: windowHours,
                gracePeriodMinutes: gracePeriodMinutes,
                enabled: enabled
            )

            showSuccess = true

            // Hide success message after delay
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            showSuccess = false

            // Refresh reminders
            await fetchReminders()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

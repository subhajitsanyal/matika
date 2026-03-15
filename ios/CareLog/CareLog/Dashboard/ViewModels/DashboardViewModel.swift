import Foundation
import SwiftUI
import Combine

/// ViewModel for patient dashboard.
@MainActor
final class DashboardViewModel: ObservableObject {
    // MARK: - Published Properties

    @Published var patientName: String?
    @Published var lastValues: [DashboardItem: String] = [:]
    @Published var pendingSyncCount: Int = 0
    @Published var missedReminder: DashboardItem?
    @Published var isLoading: Bool = false

    // MARK: - Dependencies

    private let authService: AuthService
    private let localFHIRRepository: LocalFHIRRepository
    private var cancellables = Set<AnyCancellable>()

    // MARK: - Initialization

    init(authService: AuthService = .shared, localFHIRRepository: LocalFHIRRepository = .shared) {
        self.authService = authService
        self.localFHIRRepository = localFHIRRepository

        Task {
            await loadDashboardData()
        }
        observePendingSyncCount()
    }

    // MARK: - Data Loading

    func loadDashboardData() async {
        isLoading = true
        defer { isLoading = false }

        // Load patient info
        if let user = await authService.getCurrentUser() {
            patientName = user.name

            // Load last values for each vital type
            if let patientId = user.linkedPatientId {
                await loadLastValues(patientId: patientId)
            }
        }
    }

    private func loadLastValues(patientId: String) async {
        var values: [DashboardItem: String] = [:]

        do {
            // Blood Pressure
            if let obs = try localFHIRRepository.getLatestObservation(patientId, type: .bloodPressure) {
                if let systolic = obs.components?.first(where: { $0.type == .systolicBP })?.value,
                   let diastolic = obs.components?.first(where: { $0.type == .diastolicBP })?.value {
                    values[.bloodPressure] = "\(Int(systolic))/\(Int(diastolic)) mmHg"
                }
            }

            // Glucose
            if let obs = try localFHIRRepository.getLatestObservation(patientId, type: .bloodGlucose),
               let value = obs.value {
                values[.glucose] = "\(Int(value)) mg/dL"
            }

            // Temperature
            if let obs = try localFHIRRepository.getLatestObservation(patientId, type: .bodyTemperature),
               let value = obs.value {
                values[.temperature] = String(format: "%.1f\u{00B0}F", value)
            }

            // Weight
            if let obs = try localFHIRRepository.getLatestObservation(patientId, type: .bodyWeight),
               let value = obs.value {
                values[.weight] = String(format: "%.1f kg", value)
            }

            // Pulse
            if let obs = try localFHIRRepository.getLatestObservation(patientId, type: .heartRate),
               let value = obs.value {
                values[.pulse] = "\(Int(value)) bpm"
            }

            // SpO2
            if let obs = try localFHIRRepository.getLatestObservation(patientId, type: .oxygenSaturation),
               let value = obs.value {
                values[.spO2] = "\(Int(value))%"
            }
        } catch {
            print("Error loading last values: \(error)")
        }

        lastValues = values
    }

    private func observePendingSyncCount() {
        // Pending sync count observation not yet implemented
        pendingSyncCount = 0
    }

    // MARK: - Actions

    func dismissReminder() {
        missedReminder = nil
    }

    func setMissedReminder(_ item: DashboardItem) {
        missedReminder = item
    }

    func refreshData() {
        Task {
            await loadDashboardData()
        }
    }
}


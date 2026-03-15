import Foundation
import SwiftUI
import Combine

/// ViewModel for history screen.
@MainActor
final class HistoryViewModel: ObservableObject {
    // MARK: - Published Properties

    @Published var entries: [HistoryEntry] = []
    @Published var selectedVitalType: DashboardItem?
    @Published var showDateFilter: Bool = false
    @Published var startDate: Date?
    @Published var endDate: Date?
    @Published var isLoading: Bool = false

    // MARK: - Dependencies

    private let authService: AuthService
    private let localFHIRRepository: LocalFHIRRepository
    private var cancellables = Set<AnyCancellable>()

    // MARK: - Initialization

    init(
        authService: AuthService = .shared,
        localFHIRRepository: LocalFHIRRepository = .shared
    ) {
        self.authService = authService
        self.localFHIRRepository = localFHIRRepository

        Task {
            await loadHistory()
        }

        // Reload when filters change
        $startDate
            .dropFirst()
            .sink { [weak self] _ in
                Task { await self?.loadHistory() }
            }
            .store(in: &cancellables)

        $endDate
            .dropFirst()
            .sink { [weak self] _ in
                Task { await self?.loadHistory() }
            }
            .store(in: &cancellables)
    }

    // MARK: - Actions

    func selectVitalType(_ type: DashboardItem?) {
        selectedVitalType = type
        Task {
            await loadHistory()
        }
    }

    func toggleDateFilter() {
        showDateFilter.toggle()
    }

    func clearDateFilter() {
        startDate = nil
        endDate = nil
    }

    // MARK: - Data Loading

    private func loadHistory() async {
        isLoading = true

        do {
            guard let user = await authService.getCurrentUser(),
                  let patientId = user.linkedPatientId else {
                entries = []
                isLoading = false
                return
            }

            // Get observations based on filter
            let observationType = selectedVitalType?.toObservationType()
            let observations: [FHIRObservation]

            if let type = observationType {
                observations = try localFHIRRepository.getObservationsByType(patientId, type: type)
            } else {
                observations = try localFHIRRepository.getObservationsForPatient(patientId)
            }

            // Filter by date range if set
            let filteredObservations = observations.filter { obs in
                let obsDate = obs.effectiveDateTime

                let afterStart = startDate.map { obsDate >= $0 } ?? true
                let beforeEnd = endDate.map { obsDate <= $0 } ?? true

                return afterStart && beforeEnd
            }

            // Convert to history entries
            entries = filteredObservations.map { obs in
                HistoryEntry(
                    id: obs.id ?? UUID().uuidString,
                    vitalType: obs.type.toDashboardItem(),
                    displayValue: formatDisplayValue(obs),
                    timestamp: obs.effectiveDateTime,
                    performerName: obs.performerId,
                    syncStatus: .synced
                )
            }.sorted { $0.timestamp > $1.timestamp }

            isLoading = false

        } catch {
            entries = []
            isLoading = false
        }
    }

    private func formatDisplayValue(_ obs: FHIRObservation) -> String {
        switch obs.type {
        case .bloodPressure:
            let systolic = obs.components?.first(where: { $0.type == .systolicBP })?.value
            let diastolic = obs.components?.first(where: { $0.type == .diastolicBP })?.value
            if let sys = systolic, let dia = diastolic {
                return "\(Int(sys))/\(Int(dia)) mmHg"
            }
            return "-- mmHg"

        case .bloodGlucose:
            if let value = obs.value {
                return "\(Int(value)) mg/dL"
            }
            return "-- mg/dL"

        case .bodyTemperature:
            if let celsius = obs.value {
                let fahrenheit = celsius * 9 / 5 + 32
                return String(format: "%.1f\u{00B0}F", fahrenheit)
            }
            return "--\u{00B0}F"

        case .bodyWeight:
            if let value = obs.value {
                return String(format: "%.1f kg", value)
            }
            return "-- kg"

        case .heartRate:
            if let value = obs.value {
                return "\(Int(value)) bpm"
            }
            return "-- bpm"

        case .oxygenSaturation:
            if let value = obs.value {
                return "\(Int(value))%"
            }
            return "--%"

        default:
            return "\(obs.value ?? 0) \(obs.unit ?? "")"
        }
    }
}

// MARK: - History Entry Model

struct HistoryEntry: Identifiable {
    let id: String
    let vitalType: DashboardItem
    let displayValue: String
    let timestamp: Date
    let performerName: String?
    let syncStatus: SyncStatus
}

// MARK: - Extensions

extension DashboardItem {
    func toObservationType() -> ObservationType? {
        switch self {
        case .bloodPressure: return .bloodPressure
        case .glucose: return .bloodGlucose
        case .temperature: return .bodyTemperature
        case .weight: return .bodyWeight
        case .pulse: return .heartRate
        case .spO2: return .oxygenSaturation
        default: return nil
        }
    }
}

extension ObservationType {
    func toDashboardItem() -> DashboardItem {
        switch self {
        case .bloodPressure, .systolicBP, .diastolicBP: return .bloodPressure
        case .bloodGlucose: return .glucose
        case .bodyTemperature: return .temperature
        case .bodyWeight: return .weight
        case .heartRate: return .pulse
        case .oxygenSaturation: return .spO2
        default: return .bloodPressure
        }
    }
}

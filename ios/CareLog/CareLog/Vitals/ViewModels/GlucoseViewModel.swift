import Foundation
import SwiftUI
import Combine

/// ViewModel for glucose logging screen.
@MainActor
final class GlucoseViewModel: ObservableObject {
    // MARK: - Published Properties

    @Published var value: String = ""
    @Published var unit: String = "mg/dL"
    @Published var mealTiming: MealTiming?
    @Published var valueError: String?
    @Published var isSaving: Bool = false
    @Published var saveError: String?

    // MARK: - Computed Properties

    var canSave: Bool {
        guard let doubleValue = Double(value) else { return false }
        return validateValue(doubleValue) == nil
    }

    // MARK: - Dependencies

    private let authService: AuthService
    private let localFHIRRepository: LocalFHIRRepository
    private let voicePlayer: VoiceAcknowledgementPlayer
    private var cancellables = Set<AnyCancellable>()

    // MARK: - Initialization

    init(
        authService: AuthService = .shared,
        localFHIRRepository: LocalFHIRRepository = .shared,
        voicePlayer: VoiceAcknowledgementPlayer = .shared
    ) {
        self.authService = authService
        self.localFHIRRepository = localFHIRRepository
        self.voicePlayer = voicePlayer

        setupValidation()
    }

    // MARK: - Validation

    private func setupValidation() {
        $value
            .dropFirst()
            .sink { [weak self] value in
                guard let self = self,
                      let doubleValue = Double(value) else {
                    self?.valueError = nil
                    return
                }
                self.valueError = self.validateValue(doubleValue)
            }
            .store(in: &cancellables)
    }

    private func validateValue(_ value: Double) -> String? {
        switch unit {
        case "mg/dL":
            switch value {
            case ..<20: return "Too low (min 20)"
            case 601...: return "Too high (max 600)"
            default: return nil
            }
        case "mmol/L":
            switch value {
            case ..<1.1: return "Too low (min 1.1)"
            case 33.4...: return "Too high (max 33.3)"
            default: return nil
            }
        default:
            return nil
        }
    }

    // MARK: - Unit Conversion

    func convertUnit(to newUnit: String) {
        guard let currentValue = Double(value) else { return }

        let convertedValue: Double
        if newUnit == "mmol/L" && unit == "mg/dL" {
            // Convert mg/dL to mmol/L
            convertedValue = currentValue / 18.0
            value = String(format: "%.1f", convertedValue)
        } else if newUnit == "mg/dL" && unit == "mmol/L" {
            // Convert mmol/L to mg/dL
            convertedValue = currentValue * 18.0
            value = String(format: "%.0f", convertedValue)
        }

        // Validate with new unit
        if let doubleValue = Double(value) {
            valueError = validateValue(doubleValue)
        }
    }

    // MARK: - Save

    func saveReading() async {
        guard let glucoseValue = Double(value) else { return }

        isSaving = true
        saveError = nil

        do {
            guard let user = await authService.getCurrentUser(),
                  let patientId = user.linkedPatientId else {
                throw VitalError.noPatientId
            }

            // Convert to mg/dL for storage (standard FHIR unit)
            let valueInMgDl = unit == "mmol/L" ? glucoseValue * 18.0 : glucoseValue

            // Create glucose observation
            let observation = FHIRObservation(
                patientId: patientId,
                type: .bloodGlucose,
                effectiveDateTime: Date(),
                value: valueInMgDl,
                unit: "mg/dL",
                performerId: user.userId,
                performerType: .relatedPerson,
                note: mealTiming?.displayName
            )

            // Save to local store (adds to sync queue)
            try await localFHIRRepository.saveObservation(observation)

            // Play voice acknowledgement
            voicePlayer.playSuccess(type: .bloodGlucose)

            isSaving = false

        } catch {
            isSaving = false
            saveError = error.localizedDescription
            voicePlayer.playFailure()
        }
    }
}

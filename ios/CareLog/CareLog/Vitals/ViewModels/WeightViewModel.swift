import Foundation
import SwiftUI
import Combine

/// ViewModel for weight logging screen.
@MainActor
final class WeightViewModel: ObservableObject {
    // MARK: - Published Properties

    @Published var value: String = ""
    @Published var unit: String = "kg"
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
        case "kg":
            switch value {
            case ..<20: return "Too low (min 20 kg)"
            case 301...: return "Too high (max 300 kg)"
            default: return nil
            }
        case "lbs":
            switch value {
            case ..<44: return "Too low (min 44 lbs)"
            case 661...: return "Too high (max 660 lbs)"
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
        if newUnit == "lbs" && unit == "kg" {
            // Convert kg to lbs
            convertedValue = currentValue * 2.20462
            value = String(format: "%.1f", convertedValue)
        } else if newUnit == "kg" && unit == "lbs" {
            // Convert lbs to kg
            convertedValue = currentValue / 2.20462
            value = String(format: "%.1f", convertedValue)
        }

        // Validate with new unit
        if let doubleValue = Double(value) {
            valueError = validateValue(doubleValue)
        }
    }

    // MARK: - Save

    func saveReading() async {
        guard let weightValue = Double(value) else { return }

        isSaving = true
        saveError = nil

        do {
            guard let user = await authService.getCurrentUser(),
                  let patientId = user.linkedPatientId else {
                throw VitalError.noPatientId
            }

            // Store in kg (standard FHIR unit)
            let valueInKg = unit == "lbs" ? weightValue / 2.20462 : weightValue

            // Create weight observation
            let observation = FHIRObservation(
                patientId: patientId,
                type: .bodyWeight,
                effectiveDateTime: Date(),
                value: valueInKg,
                unit: "kg",
                performerId: user.userId,
                performerType: .relatedPerson
            )

            // Save to local store (adds to sync queue)
            try await localFHIRRepository.saveObservation(observation)

            // Play voice acknowledgement
            voicePlayer.playSuccess(type: .bodyWeight)

            isSaving = false

        } catch {
            isSaving = false
            saveError = error.localizedDescription
            voicePlayer.playFailure()
        }
    }
}

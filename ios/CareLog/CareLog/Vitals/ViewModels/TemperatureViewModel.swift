import Foundation
import SwiftUI
import Combine

/// ViewModel for temperature logging screen.
@MainActor
final class TemperatureViewModel: ObservableObject {
    // MARK: - Published Properties

    @Published var value: String = ""
    @Published var unit: String = "\u{00B0}F"
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
        case "\u{00B0}F":
            switch value {
            case ..<90: return "Too low (min 90\u{00B0}F)"
            case 111...: return "Too high (max 110\u{00B0}F)"
            default: return nil
            }
        case "\u{00B0}C":
            switch value {
            case ..<32: return "Too low (min 32\u{00B0}C)"
            case 44...: return "Too high (max 43\u{00B0}C)"
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
        if newUnit == "\u{00B0}C" && unit == "\u{00B0}F" {
            // Convert F to C
            convertedValue = (currentValue - 32) * 5 / 9
            value = String(format: "%.1f", convertedValue)
        } else if newUnit == "\u{00B0}F" && unit == "\u{00B0}C" {
            // Convert C to F
            convertedValue = currentValue * 9 / 5 + 32
            value = String(format: "%.1f", convertedValue)
        }

        // Validate with new unit
        if let doubleValue = Double(value) {
            valueError = validateValue(doubleValue)
        }
    }

    // MARK: - Save

    func saveReading() async {
        guard let tempValue = Double(value) else { return }

        isSaving = true
        saveError = nil

        do {
            guard let user = await authService.getCurrentUser(),
                  let patientId = user.linkedPatientId else {
                throw VitalError.noPatientId
            }

            // Store in Celsius (standard FHIR unit)
            let valueInCelsius = unit == "\u{00B0}F" ? (tempValue - 32) * 5 / 9 : tempValue

            // Create temperature observation
            let observation = FHIRObservation(
                patientId: patientId,
                type: .bodyTemperature,
                effectiveDateTime: Date(),
                value: valueInCelsius,
                unit: "Cel",
                performerId: user.userId,
                performerType: .relatedPerson
            )

            // Save to local store (adds to sync queue)
            try await localFHIRRepository.saveObservation(observation)

            // Play voice acknowledgement
            voicePlayer.playSuccess(type: .bodyTemperature)

            isSaving = false

        } catch {
            isSaving = false
            saveError = error.localizedDescription
            voicePlayer.playFailure()
        }
    }
}

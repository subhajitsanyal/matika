import Foundation
import SwiftUI
import Combine

/// ViewModel for SpO2 (oxygen saturation) logging screen.
@MainActor
final class SpO2ViewModel: ObservableObject {
    // MARK: - Published Properties

    @Published var value: String = ""
    @Published var valueError: String?
    @Published var showLowWarning: Bool = false
    @Published var isSaving: Bool = false
    @Published var saveError: String?

    // MARK: - Computed Properties

    var canSave: Bool {
        guard let intValue = Int(value) else { return false }
        return validateValue(intValue) == nil
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
                      let intValue = Int(value) else {
                    self?.valueError = nil
                    self?.showLowWarning = false
                    return
                }
                self.valueError = self.validateValue(intValue)
                self.showLowWarning = intValue >= 90 && intValue <= 94
            }
            .store(in: &cancellables)
    }

    private func validateValue(_ value: Int) -> String? {
        switch value {
        case ..<70: return "Too low (min 70%)"
        case 101...: return "Cannot exceed 100%"
        default: return nil
        }
    }

    // MARK: - Save

    func saveReading() async {
        guard let spo2Value = Int(value) else { return }

        isSaving = true
        saveError = nil

        do {
            guard let user = await authService.getCurrentUser(),
                  let patientId = user.linkedPatientId else {
                throw VitalError.noPatientId
            }

            // Create SpO2 observation
            let observation = LocalObservation(
                id: UUID().uuidString,
                patientId: patientId,
                type: .oxygenSaturation,
                value: Double(spo2Value),
                unit: "%",
                effectiveDateTime: Date(),
                performerName: user.name
            )

            // Save to local store (adds to sync queue)
            try await localFHIRRepository.saveObservation(observation)

            // Play voice acknowledgement
            voicePlayer.playSuccess(type: .oxygenSaturation)

            isSaving = false

        } catch {
            isSaving = false
            saveError = error.localizedDescription
            voicePlayer.playFailure()
        }
    }
}

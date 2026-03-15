import Foundation
import SwiftUI
import Combine

/// ViewModel for pulse/heart rate logging screen.
@MainActor
final class PulseViewModel: ObservableObject {
    // MARK: - Published Properties

    @Published var value: String = ""
    @Published var valueError: String?
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
                    return
                }
                self.valueError = self.validateValue(intValue)
            }
            .store(in: &cancellables)
    }

    private func validateValue(_ value: Int) -> String? {
        switch value {
        case ..<30: return "Too low (min 30 bpm)"
        case 251...: return "Too high (max 250 bpm)"
        default: return nil
        }
    }

    // MARK: - Save

    func saveReading() async {
        guard let pulseValue = Int(value) else { return }

        isSaving = true
        saveError = nil

        do {
            guard let user = await authService.getCurrentUser(),
                  let patientId = user.linkedPatientId else {
                throw VitalError.noPatientId
            }

            // Create heart rate observation
            let observation = FHIRObservation(
                patientId: patientId,
                type: .heartRate,
                effectiveDateTime: Date(),
                value: Double(pulseValue),
                unit: "/min",
                performerId: user.userId,
                performerType: .relatedPerson
            )

            // Save to local store (adds to sync queue)
            try await localFHIRRepository.saveObservation(observation)

            // Play voice acknowledgement
            voicePlayer.playSuccess(type: .heartRate)

            isSaving = false

        } catch {
            isSaving = false
            saveError = error.localizedDescription
            voicePlayer.playFailure()
        }
    }
}

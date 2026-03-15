import Foundation
import SwiftUI
import Combine

/// ViewModel for blood pressure logging screen.
@MainActor
final class BloodPressureViewModel: ObservableObject {
    // MARK: - Published Properties

    @Published var systolic: String = ""
    @Published var diastolic: String = ""
    @Published var systolicError: String?
    @Published var diastolicError: String?
    @Published var isSaving: Bool = false
    @Published var saveError: String?

    // MARK: - Computed Properties

    var canSave: Bool {
        guard let sys = Int(systolic), let dia = Int(diastolic) else { return false }
        return validateSystolic(sys) == nil &&
               validateDiastolic(dia) == nil &&
               sys > dia
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
        $systolic
            .dropFirst()
            .sink { [weak self] value in
                guard let intValue = Int(value) else {
                    self?.systolicError = nil
                    return
                }
                self?.systolicError = self?.validateSystolic(intValue)
            }
            .store(in: &cancellables)

        $diastolic
            .dropFirst()
            .sink { [weak self] value in
                guard let intValue = Int(value) else {
                    self?.diastolicError = nil
                    return
                }
                self?.diastolicError = self?.validateDiastolic(intValue)
            }
            .store(in: &cancellables)
    }

    private func validateSystolic(_ value: Int) -> String? {
        switch value {
        case ..<60: return "Too low (min 60)"
        case 301...: return "Too high (max 300)"
        default: return nil
        }
    }

    private func validateDiastolic(_ value: Int) -> String? {
        switch value {
        case ..<30: return "Too low (min 30)"
        case 201...: return "Too high (max 200)"
        default: return nil
        }
    }

    // MARK: - Save

    func saveReading() async {
        guard let sys = Int(systolic), let dia = Int(diastolic) else { return }

        isSaving = true
        saveError = nil

        do {
            guard let user = await authService.getCurrentUser(),
                  let patientId = user.linkedPatientId else {
                throw VitalError.noPatientId
            }

            // Create blood pressure observation with components
            let observation = FHIRObservation(
                patientId: patientId,
                type: .bloodPressure,
                effectiveDateTime: Date(),
                unit: "mmHg",
                components: [
                    ObservationComponent(type: .systolicBP, value: Double(sys), unit: "mmHg"),
                    ObservationComponent(type: .diastolicBP, value: Double(dia), unit: "mmHg")
                ],
                performerId: user.userId,
                performerType: .relatedPerson
            )

            // Save to local store (adds to sync queue)
            try await localFHIRRepository.saveObservation(observation)

            // Play voice acknowledgement
            voicePlayer.playSuccess(type: .bloodPressure)

            isSaving = false

        } catch {
            isSaving = false
            saveError = error.localizedDescription
            voicePlayer.playFailure()
        }
    }
}

// MARK: - Errors

enum VitalError: LocalizedError {
    case noPatientId

    var errorDescription: String? {
        switch self {
        case .noPatientId:
            return "No patient ID available"
        }
    }
}

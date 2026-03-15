import AVFoundation
import Foundation

/// Plays voice acknowledgement audio clips for vital logging events.
///
/// Audio plays through media stream to work even in silent mode.
final class VoiceAcknowledgementPlayer {
    static let shared = VoiceAcknowledgementPlayer()

    private var audioPlayer: AVAudioPlayer?

    private init() {
        setupAudioSession()
    }

    // MARK: - Audio Session Setup

    private func setupAudioSession() {
        do {
            // Configure audio session to play through speaker even in silent mode
            try AVAudioSession.sharedInstance().setCategory(
                .playback,
                mode: .default,
                options: [.mixWithOthers]
            )
            try AVAudioSession.sharedInstance().setActive(true)
        } catch {
            print("Failed to configure audio session: \(error)")
        }
    }

    // MARK: - Playback Methods

    /// Play success acknowledgement for a specific vital type.
    func playSuccess(type: ObservationType) {
        let audioName = getSuccessAudioName(for: type)
        playAudio(named: audioName)
    }

    /// Play generic success acknowledgement.
    func playGenericSuccess() {
        playAudio(named: "success_generic")
    }

    /// Play failure acknowledgement.
    func playFailure() {
        playAudio(named: "failure")
    }

    /// Play no network acknowledgement.
    func playNoNetwork() {
        playAudio(named: "no_network")
    }

    /// Play upload success acknowledgement.
    func playUploadSuccess() {
        playAudio(named: "upload_success")
    }

    // MARK: - Private Methods

    private func playAudio(named name: String) {
        guard let url = Bundle.main.url(forResource: name, withExtension: "mp3") ??
                        Bundle.main.url(forResource: name, withExtension: "m4a") ??
                        Bundle.main.url(forResource: "success_generic", withExtension: "mp3") else {
            // Audio file not found - silent fail
            return
        }

        do {
            audioPlayer = try AVAudioPlayer(contentsOf: url)
            audioPlayer?.prepareToPlay()
            audioPlayer?.play()
        } catch {
            print("Failed to play audio: \(error)")
        }
    }

    private func getSuccessAudioName(for type: ObservationType) -> String {
        switch type {
        case .bloodPressure:
            return "success_blood_pressure"
        case .bloodGlucose:
            return "success_glucose"
        case .bodyTemperature:
            return "success_temperature"
        case .bodyWeight:
            return "success_weight"
        case .heartRate:
            return "success_pulse"
        case .oxygenSaturation:
            return "success_spo2"
        default:
            return "success_generic"
        }
    }

    // MARK: - Cleanup

    func stop() {
        audioPlayer?.stop()
        audioPlayer = nil
    }
}

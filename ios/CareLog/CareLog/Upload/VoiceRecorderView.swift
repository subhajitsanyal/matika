import SwiftUI
import AVFoundation

/// Voice note recording view.
struct VoiceRecorderView: View {
    let onRecordingComplete: (URL) -> Void
    @Environment(\.dismiss) private var dismiss

    @StateObject private var recorder = VoiceRecorder()
    @State private var showPlayback = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 32) {
                Spacer()

                // Recording indicator
                RecordingIndicator(
                    isRecording: recorder.isRecording,
                    duration: recorder.recordingDuration
                )

                Spacer()

                // Controls
                if showPlayback, let url = recorder.recordingURL {
                    PlaybackControls(
                        url: url,
                        onRetake: {
                            showPlayback = false
                            recorder.deleteRecording()
                        },
                        onUse: {
                            onRecordingComplete(url)
                            dismiss()
                        }
                    )
                } else {
                    RecordingControls(
                        isRecording: recorder.isRecording,
                        onStartRecording: {
                            recorder.startRecording()
                        },
                        onStopRecording: {
                            recorder.stopRecording()
                            showPlayback = true
                        }
                    )
                }

                Spacer()
            }
            .padding()
            .navigationTitle("Voice Note")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        recorder.stopRecording()
                        recorder.deleteRecording()
                        dismiss()
                    }
                }
            }
            .alert("Recording Error", isPresented: .constant(recorder.error != nil)) {
                Button("OK") {
                    recorder.error = nil
                }
            } message: {
                Text(recorder.error ?? "")
            }
        }
        .onDisappear {
            recorder.cleanup()
        }
    }
}

// MARK: - Recording Indicator

struct RecordingIndicator: View {
    let isRecording: Bool
    let duration: TimeInterval

    var body: some View {
        VStack(spacing: 24) {
            // Waveform animation
            ZStack {
                Circle()
                    .fill(isRecording ? CareLogColors.error.opacity(0.2) : Color.gray.opacity(0.1))
                    .frame(width: 200, height: 200)

                if isRecording {
                    Circle()
                        .stroke(CareLogColors.error, lineWidth: 4)
                        .frame(width: 200, height: 200)
                        .scaleEffect(isRecording ? 1.1 : 1.0)
                        .opacity(isRecording ? 0.5 : 1.0)
                        .animation(.easeInOut(duration: 0.8).repeatForever(autoreverses: true), value: isRecording)
                }

                Image(systemName: "mic.fill")
                    .font(.system(size: 60))
                    .foregroundColor(isRecording ? CareLogColors.error : .gray)
            }

            // Timer
            Text(formatDuration(duration))
                .font(.system(size: 48, weight: .light, design: .monospaced))
                .foregroundColor(isRecording ? CareLogColors.error : .primary)
        }
    }

    private func formatDuration(_ duration: TimeInterval) -> String {
        let minutes = Int(duration) / 60
        let seconds = Int(duration) % 60
        return String(format: "%02d:%02d", minutes, seconds)
    }
}

// MARK: - Recording Controls

struct RecordingControls: View {
    let isRecording: Bool
    let onStartRecording: () -> Void
    let onStopRecording: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            Button(action: {
                if isRecording {
                    onStopRecording()
                } else {
                    onStartRecording()
                }
            }) {
                ZStack {
                    Circle()
                        .fill(isRecording ? CareLogColors.error : CareLogColors.primary)
                        .frame(width: 80, height: 80)

                    if isRecording {
                        RoundedRectangle(cornerRadius: 4)
                            .fill(.white)
                            .frame(width: 24, height: 24)
                    } else {
                        Circle()
                            .fill(.white)
                            .frame(width: 24, height: 24)
                    }
                }
            }

            Text(isRecording ? "Tap to stop" : "Tap to record")
                .font(.subheadline)
                .foregroundColor(.secondary)
        }
    }
}

// MARK: - Playback Controls

struct PlaybackControls: View {
    let url: URL
    let onRetake: () -> Void
    let onUse: () -> Void

    @StateObject private var player = AudioPlayer()

    var body: some View {
        VStack(spacing: 24) {
            // Playback button
            Button(action: {
                if player.isPlaying {
                    player.pause()
                } else {
                    player.play(url: url)
                }
            }) {
                ZStack {
                    Circle()
                        .fill(CareLogColors.primary.opacity(0.1))
                        .frame(width: 80, height: 80)

                    Image(systemName: player.isPlaying ? "pause.fill" : "play.fill")
                        .font(.title)
                        .foregroundColor(CareLogColors.primary)
                }
            }

            // Progress
            if player.duration > 0 {
                VStack(spacing: 8) {
                    ProgressView(value: player.currentTime, total: player.duration)
                        .tint(CareLogColors.primary)

                    HStack {
                        Text(formatDuration(player.currentTime))
                        Spacer()
                        Text(formatDuration(player.duration))
                    }
                    .font(.caption)
                    .foregroundColor(.secondary)
                }
                .padding(.horizontal, 32)
            }

            // Action buttons
            HStack(spacing: 40) {
                Button(action: onRetake) {
                    VStack {
                        Image(systemName: "arrow.counterclockwise")
                            .font(.title2)
                        Text("Retake")
                            .font(.caption)
                    }
                    .foregroundColor(.secondary)
                    .frame(width: 80, height: 60)
                }

                Button(action: onUse) {
                    VStack {
                        Image(systemName: "checkmark")
                            .font(.title2)
                        Text("Use")
                            .font(.caption)
                    }
                    .foregroundColor(.white)
                    .frame(width: 80, height: 60)
                    .background(CareLogColors.primary)
                    .cornerRadius(12)
                }
            }
        }
        .onDisappear {
            player.stop()
        }
    }

    private func formatDuration(_ duration: TimeInterval) -> String {
        let minutes = Int(duration) / 60
        let seconds = Int(duration) % 60
        return String(format: "%02d:%02d", minutes, seconds)
    }
}

// MARK: - Voice Recorder

@MainActor
final class VoiceRecorder: NSObject, ObservableObject {
    @Published var isRecording = false
    @Published var recordingDuration: TimeInterval = 0
    @Published var recordingURL: URL?
    @Published var error: String?

    private var audioRecorder: AVAudioRecorder?
    private var timer: Timer?

    override init() {
        super.init()
    }

    func startRecording() {
        // Request permission
        AVAudioSession.sharedInstance().requestRecordPermission { [weak self] granted in
            Task { @MainActor in
                if granted {
                    self?.beginRecording()
                } else {
                    self?.error = "Microphone access denied"
                }
            }
        }
    }

    private func beginRecording() {
        let session = AVAudioSession.sharedInstance()

        do {
            try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker])
            try session.setActive(true)
        } catch {
            self.error = "Could not configure audio session"
            return
        }

        // Create recording URL
        let fileName = "voice_note_\(Date().timeIntervalSince1970).m4a"
        let documentsURL = FileManager.default.temporaryDirectory
        let fileURL = documentsURL.appendingPathComponent(fileName)
        recordingURL = fileURL

        // Recording settings
        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 44100.0,
            AVNumberOfChannelsKey: 1,
            AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue
        ]

        do {
            audioRecorder = try AVAudioRecorder(url: fileURL, settings: settings)
            audioRecorder?.record()
            isRecording = true
            recordingDuration = 0
            startTimer()
        } catch {
            self.error = "Could not start recording"
        }
    }

    func stopRecording() {
        audioRecorder?.stop()
        isRecording = false
        stopTimer()
    }

    func deleteRecording() {
        if let url = recordingURL {
            try? FileManager.default.removeItem(at: url)
        }
        recordingURL = nil
        recordingDuration = 0
    }

    func cleanup() {
        stopRecording()
        audioRecorder = nil
    }

    private func startTimer() {
        timer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
            Task { @MainActor in
                if let recorder = self?.audioRecorder, recorder.isRecording {
                    self?.recordingDuration = recorder.currentTime
                }
            }
        }
    }

    private func stopTimer() {
        timer?.invalidate()
        timer = nil
    }
}

// MARK: - Audio Player

@MainActor
final class AudioPlayer: NSObject, ObservableObject {
    @Published var isPlaying = false
    @Published var currentTime: TimeInterval = 0
    @Published var duration: TimeInterval = 0

    private var audioPlayer: AVAudioPlayer?
    private var timer: Timer?

    func play(url: URL) {
        do {
            try AVAudioSession.sharedInstance().setCategory(.playback)
            try AVAudioSession.sharedInstance().setActive(true)

            audioPlayer = try AVAudioPlayer(contentsOf: url)
            audioPlayer?.delegate = self
            audioPlayer?.prepareToPlay()
            duration = audioPlayer?.duration ?? 0
            audioPlayer?.play()
            isPlaying = true
            startTimer()
        } catch {
            print("Playback error: \(error)")
        }
    }

    func pause() {
        audioPlayer?.pause()
        isPlaying = false
        stopTimer()
    }

    func stop() {
        audioPlayer?.stop()
        isPlaying = false
        currentTime = 0
        stopTimer()
    }

    private func startTimer() {
        timer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.currentTime = self?.audioPlayer?.currentTime ?? 0
            }
        }
    }

    private func stopTimer() {
        timer?.invalidate()
        timer = nil
    }
}

extension AudioPlayer: AVAudioPlayerDelegate {
    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        Task { @MainActor in
            isPlaying = false
            currentTime = 0
            stopTimer()
        }
    }
}

// MARK: - Preview

#Preview {
    VoiceRecorderView { _ in }
}

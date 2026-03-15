import SwiftUI
import AVFoundation

/// Attendant observations/notes view.
/// Allows attendants to add free-text observations and voice notes.
struct AttendantNotesView: View {
    @StateObject private var viewModel = AttendantNotesViewModel()
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 24) {
                    // Note type selector
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Observation Type")
                            .font(.subheadline)
                            .fontWeight(.medium)

                        HStack(spacing: 8) {
                            ForEach(NoteType.allCases, id: \.self) { type in
                                NoteTypeChip(
                                    label: type.displayName,
                                    isSelected: viewModel.noteType == type
                                ) {
                                    viewModel.noteType = type
                                }
                            }
                        }
                    }

                    // Text note input
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Written Note")
                            .font(.subheadline)
                            .fontWeight(.medium)

                        TextEditor(text: $viewModel.textNote)
                            .frame(height: 160)
                            .padding(8)
                            .background(Color(.secondarySystemBackground))
                            .cornerRadius(8)
                            .overlay(
                                RoundedRectangle(cornerRadius: 8)
                                    .stroke(Color(.systemGray4), lineWidth: 1)
                            )
                    }

                    // Voice note section
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Voice Note (Optional)")
                            .font(.subheadline)
                            .fontWeight(.medium)

                        VoiceRecordingSection(viewModel: viewModel)
                    }

                    // Error message
                    if let error = viewModel.error {
                        Text(error)
                            .font(.caption)
                            .foregroundColor(.red)
                    }

                    // Success message
                    if viewModel.saveSuccess {
                        HStack {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundColor(CareLogColors.success)
                            Text("Observation saved successfully")
                                .foregroundColor(CareLogColors.success)
                        }
                        .padding()
                        .frame(maxWidth: .infinity)
                        .background(CareLogColors.success.opacity(0.1))
                        .cornerRadius(8)
                    }

                    Spacer().frame(height: 16)

                    // Save button
                    Button(action: {
                        viewModel.saveNote()
                    }) {
                        if viewModel.isSaving {
                            ProgressView()
                                .progressViewStyle(CircularProgressViewStyle(tint: .white))
                                .frame(maxWidth: .infinity)
                                .frame(height: 50)
                        } else {
                            Text("Save Observation")
                                .fontWeight(.semibold)
                                .frame(maxWidth: .infinity)
                                .frame(height: 50)
                        }
                    }
                    .background(
                        (viewModel.textNote.isEmpty && !viewModel.hasVoiceRecording)
                            ? Color.gray
                            : CareLogColors.primary
                    )
                    .foregroundColor(.white)
                    .cornerRadius(10)
                    .disabled(viewModel.textNote.isEmpty && !viewModel.hasVoiceRecording)
                }
                .padding()
            }
            .navigationTitle("Add Observation")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
            }
            .onChange(of: viewModel.saveSuccess) { _, success in
                if success {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
                        dismiss()
                    }
                }
            }
        }
    }
}

// MARK: - Note Type Chip

private struct NoteTypeChip: View {
    let label: String
    let isSelected: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            Text(label)
                .font(.subheadline)
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
                .background(isSelected ? CareLogColors.primary : Color(.systemGray5))
                .foregroundColor(isSelected ? .white : .primary)
                .cornerRadius(20)
        }
    }
}

// MARK: - Voice Recording Section

private struct VoiceRecordingSection: View {
    @ObservedObject var viewModel: AttendantNotesViewModel

    var body: some View {
        VStack(spacing: 16) {
            if viewModel.isRecording {
                // Recording state
                HStack {
                    Circle()
                        .fill(CareLogColors.error)
                        .frame(width: 12, height: 12)
                    Text("Recording... \(formatDuration(viewModel.recordingDuration))")
                }

                Button(action: { viewModel.toggleRecording() }) {
                    Image(systemName: "stop.fill")
                        .font(.title)
                        .foregroundColor(.white)
                        .frame(width: 64, height: 64)
                        .background(CareLogColors.error)
                        .clipShape(Circle())
                }
            } else if viewModel.hasVoiceRecording {
                // Has recording state
                HStack {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundColor(CareLogColors.success)
                    Text("Voice note recorded (\(formatDuration(viewModel.recordingDuration)))")
                }

                HStack(spacing: 12) {
                    Button(action: { viewModel.toggleRecording() }) {
                        HStack {
                            Image(systemName: "arrow.clockwise")
                            Text("Re-record")
                        }
                        .padding(.horizontal, 16)
                        .padding(.vertical, 8)
                        .overlay(
                            RoundedRectangle(cornerRadius: 8)
                                .stroke(Color(.systemGray3), lineWidth: 1)
                        )
                    }

                    Button(action: { viewModel.deleteRecording() }) {
                        HStack {
                            Image(systemName: "trash")
                            Text("Delete")
                        }
                        .foregroundColor(CareLogColors.error)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 8)
                        .overlay(
                            RoundedRectangle(cornerRadius: 8)
                                .stroke(CareLogColors.error, lineWidth: 1)
                        )
                    }
                }
            } else {
                // Initial state
                Text("Tap to record a voice note")
                    .font(.subheadline)
                    .foregroundColor(.secondary)

                Button(action: { viewModel.toggleRecording() }) {
                    Image(systemName: "mic.fill")
                        .font(.title)
                        .foregroundColor(.white)
                        .frame(width: 64, height: 64)
                        .background(CareLogColors.primary)
                        .clipShape(Circle())
                }
            }
        }
        .padding()
        .frame(maxWidth: .infinity)
        .background(Color(.secondarySystemBackground))
        .cornerRadius(16)
    }

    private func formatDuration(_ seconds: Int) -> String {
        let mins = seconds / 60
        let secs = seconds % 60
        return String(format: "%d:%02d", mins, secs)
    }
}

// MARK: - Note Type

enum NoteType: String, CaseIterable {
    case general
    case symptoms
    case medication

    var displayName: String {
        switch self {
        case .general: return "General"
        case .symptoms: return "Symptoms"
        case .medication: return "Medication"
        }
    }
}

// MARK: - ViewModel

@MainActor
class AttendantNotesViewModel: ObservableObject {
    @Published var noteType: NoteType = .general
    @Published var textNote = ""
    @Published var isRecording = false
    @Published var recordingDuration = 0
    @Published var hasVoiceRecording = false
    @Published var isSaving = false
    @Published var saveSuccess = false
    @Published var error: String?

    private let sessionManager = AttendantSessionManager.shared
    private var recordingTimer: Timer?

    func toggleRecording() {
        if isRecording {
            stopRecording()
        } else {
            startRecording()
        }
    }

    private func startRecording() {
        // Request microphone permission
        AVAudioSession.sharedInstance().requestRecordPermission { granted in
            DispatchQueue.main.async {
                if granted {
                    self.isRecording = true
                    self.recordingDuration = 0

                    // Start timer
                    self.recordingTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { _ in
                        self.recordingDuration += 1
                    }

                    // Note: Actual AVAudioRecorder implementation would go here
                } else {
                    self.error = "Microphone permission denied"
                }
            }
        }
    }

    private func stopRecording() {
        recordingTimer?.invalidate()
        recordingTimer = nil
        isRecording = false
        hasVoiceRecording = true

        // Note: Stop AVAudioRecorder and save file
    }

    func deleteRecording() {
        hasVoiceRecording = false
        recordingDuration = 0

        // Note: Delete recording file
    }

    func saveNote() {
        guard !textNote.isEmpty || hasVoiceRecording else { return }

        isSaving = true
        error = nil

        Task {
            do {
                let performer = sessionManager.getPerformerInfo()

                // Note: Save observation to FHIR store
                // - Create FHIR Observation with note type
                // - Include performer info
                // - Upload voice recording if present
                // - Add to sync queue

                try await Task.sleep(nanoseconds: 1_000_000_000) // Simulate save

                saveSuccess = true
            } catch {
                self.error = error.localizedDescription
            }
            isSaving = false
        }
    }
}

// MARK: - Preview

#Preview {
    AttendantNotesView()
}

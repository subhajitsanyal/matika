import SwiftUI

/// Pulse/Heart rate logging screen.
///
/// Single numeric input (bpm).
/// LOINC code: 8867-4
struct PulseView: View {
    @StateObject private var viewModel = PulseViewModel()
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 24) {
            Spacer()
                .frame(height: 64)

            // Pulse value input
            VitalNumericInput(
                label: nil,
                value: $viewModel.value,
                placeholder: "72",
                unit: "bpm",
                allowDecimal: false,
                accentColor: CareLogColors.pulse,
                errorMessage: viewModel.valueError
            )

            // Info text
            Text("Normal resting heart rate: 60-100 bpm")
                .font(.subheadline)
                .foregroundColor(CareLogColors.onSurfaceVariant)

            Spacer()

            // Save button
            SaveButton(
                title: "Save",
                isEnabled: viewModel.canSave,
                isLoading: viewModel.isSaving,
                accentColor: CareLogColors.pulse
            ) {
                Task {
                    await viewModel.saveReading()
                    dismiss()
                }
            }

            Spacer()
                .frame(height: 24)
        }
        .padding(.horizontal, 24)
        .navigationTitle("Heart Rate")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(CareLogColors.pulse, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
    }
}

// MARK: - Preview

#Preview {
    NavigationStack {
        PulseView()
    }
}

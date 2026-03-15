import SwiftUI

/// SpO2 (Oxygen Saturation) logging screen.
///
/// Single numeric input (percentage).
/// LOINC code: 2708-6
struct SpO2View: View {
    @StateObject private var viewModel = SpO2ViewModel()
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 24) {
            Spacer()
                .frame(height: 64)

            // SpO2 value input
            VitalNumericInput(
                label: nil,
                value: $viewModel.value,
                placeholder: "98",
                unit: "%",
                allowDecimal: false,
                accentColor: CareLogColors.spO2,
                errorMessage: viewModel.valueError
            )

            // Info text
            Text("Normal oxygen saturation: 95-100%")
                .font(.subheadline)
                .foregroundColor(CareLogColors.onSurfaceVariant)

            // Warning for low values
            if viewModel.showLowWarning {
                HStack {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundColor(CareLogColors.warning)
                    Text("Low oxygen levels may require medical attention")
                        .font(.subheadline)
                        .foregroundColor(CareLogColors.warning)
                }
                .padding()
                .background(CareLogColors.warning.opacity(0.15))
                .cornerRadius(12)
            }

            Spacer()

            // Save button
            SaveButton(
                title: "Save",
                isEnabled: viewModel.canSave,
                isLoading: viewModel.isSaving,
                accentColor: CareLogColors.spO2
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
        .navigationTitle("Oxygen Level")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(CareLogColors.spO2, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
    }
}

// MARK: - Preview

#Preview {
    NavigationStack {
        SpO2View()
    }
}

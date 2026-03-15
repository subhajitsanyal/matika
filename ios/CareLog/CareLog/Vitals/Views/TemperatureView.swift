import SwiftUI

/// Temperature logging screen.
///
/// Single numeric input with C/F unit toggle.
/// LOINC code: 8310-5
struct TemperatureView: View {
    @StateObject private var viewModel = TemperatureViewModel()
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 24) {
            Spacer()
                .frame(height: 48)

            // Unit toggle
            UnitToggle(
                options: ["\u{00B0}F", "\u{00B0}C"],
                selectedOption: $viewModel.unit,
                accentColor: CareLogColors.temperature
            )
            .onChange(of: viewModel.unit) { _, newUnit in
                viewModel.convertUnit(to: newUnit)
            }

            Spacer()
                .frame(height: 24)

            // Temperature value input
            VitalNumericInput(
                label: nil,
                value: $viewModel.value,
                placeholder: viewModel.unit == "\u{00B0}F" ? "98.6" : "37.0",
                unit: viewModel.unit,
                allowDecimal: true,
                accentColor: CareLogColors.temperature,
                errorMessage: viewModel.valueError
            )

            Spacer()

            // Save button
            SaveButton(
                title: "Save",
                isEnabled: viewModel.canSave,
                isLoading: viewModel.isSaving,
                accentColor: CareLogColors.temperature
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
        .navigationTitle("Temperature")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(CareLogColors.temperature, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
    }
}

// MARK: - Preview

#Preview {
    NavigationStack {
        TemperatureView()
    }
}

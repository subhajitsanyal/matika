import SwiftUI

/// Weight logging screen.
///
/// Single numeric input with kg/lbs unit toggle.
/// LOINC code: 29463-7
struct WeightView: View {
    @StateObject private var viewModel = WeightViewModel()
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 24) {
            Spacer()
                .frame(height: 48)

            // Unit toggle
            UnitToggle(
                options: ["kg", "lbs"],
                selectedOption: $viewModel.unit,
                accentColor: CareLogColors.weight
            )
            .onChange(of: viewModel.unit) { _, newUnit in
                viewModel.convertUnit(to: newUnit)
            }

            Spacer()
                .frame(height: 24)

            // Weight value input
            VitalNumericInput(
                label: nil,
                value: $viewModel.value,
                placeholder: viewModel.unit == "kg" ? "70.0" : "154.0",
                unit: viewModel.unit,
                allowDecimal: true,
                accentColor: CareLogColors.weight,
                errorMessage: viewModel.valueError
            )

            Spacer()

            // Save button
            SaveButton(
                title: "Save",
                isEnabled: viewModel.canSave,
                isLoading: viewModel.isSaving,
                accentColor: CareLogColors.weight
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
        .navigationTitle("Weight")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(CareLogColors.weight, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
    }
}

// MARK: - Preview

#Preview {
    NavigationStack {
        WeightView()
    }
}

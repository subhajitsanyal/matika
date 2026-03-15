import SwiftUI

/// Blood pressure logging screen.
///
/// Full-screen, single-action UI with two large numeric inputs (systolic/diastolic).
/// LOINC codes: Systolic 8480-6, Diastolic 8462-4
struct BloodPressureView: View {
    @StateObject private var viewModel = BloodPressureViewModel()
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 24) {
            Spacer()
                .frame(height: 32)

            // Systolic input
            VitalNumericInput(
                label: "Systolic",
                value: $viewModel.systolic,
                placeholder: "120",
                unit: "mmHg",
                accentColor: CareLogColors.bloodPressure,
                errorMessage: viewModel.systolicError
            )

            // Divider
            Text("/")
                .font(.system(size: 48, weight: .bold))
                .foregroundColor(CareLogColors.onSurfaceVariant)

            // Diastolic input
            VitalNumericInput(
                label: "Diastolic",
                value: $viewModel.diastolic,
                placeholder: "80",
                unit: "mmHg",
                accentColor: CareLogColors.bloodPressure,
                errorMessage: viewModel.diastolicError
            )

            Spacer()

            // Save button
            SaveButton(
                title: "Save",
                isEnabled: viewModel.canSave,
                isLoading: viewModel.isSaving,
                accentColor: CareLogColors.bloodPressure
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
        .navigationTitle("Blood Pressure")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(CareLogColors.bloodPressure, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
    }
}

// MARK: - Reusable Components

/// Large numeric input field for vital values.
struct VitalNumericInput: View {
    let label: String?
    @Binding var value: String
    let placeholder: String
    let unit: String
    var allowDecimal: Bool = false
    var accentColor: Color = CareLogColors.primary
    var errorMessage: String? = nil

    var body: some View {
        VStack(spacing: 8) {
            if let label = label {
                Text(label)
                    .font(.headline)
                    .foregroundColor(CareLogColors.onSurfaceVariant)
            }

            HStack(spacing: 12) {
                TextField(placeholder, text: $value)
                    .keyboardType(allowDecimal ? .decimalPad : .numberPad)
                    .font(.system(size: 48, weight: .bold))
                    .multilineTextAlignment(.center)
                    .frame(width: allowDecimal ? 160 : 140)
                    .padding()
                    .background(
                        RoundedRectangle(cornerRadius: 12)
                            .stroke(
                                errorMessage != nil ? CareLogColors.error : accentColor,
                                lineWidth: 2
                            )
                    )
                    .onChange(of: value) { _, newValue in
                        // Filter input
                        let filtered = filterNumericInput(newValue, allowDecimal: allowDecimal)
                        if filtered != newValue {
                            value = filtered
                        }
                    }

                Text(unit)
                    .font(.headline)
                    .foregroundColor(CareLogColors.onSurfaceVariant)
            }

            if let error = errorMessage {
                Text(error)
                    .font(.caption)
                    .foregroundColor(CareLogColors.error)
            }
        }
    }

    private func filterNumericInput(_ input: String, allowDecimal: Bool) -> String {
        if allowDecimal {
            // Allow digits and one decimal point
            let filtered = input.filter { $0.isNumber || $0 == "." }
            let parts = filtered.split(separator: ".", omittingEmptySubsequences: false)
            if parts.count > 2 {
                return String(parts[0]) + "." + String(parts[1])
            }
            return filtered
        } else {
            return input.filter { $0.isNumber }
        }
    }
}

/// Large save button with loading state.
struct SaveButton: View {
    let title: String
    let isEnabled: Bool
    let isLoading: Bool
    var accentColor: Color = CareLogColors.primary
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                if isLoading {
                    ProgressView()
                        .progressViewStyle(CircularProgressViewStyle(tint: .white))
                } else {
                    Image(systemName: "checkmark")
                        .font(.title2)
                    Text(title)
                        .font(.title2)
                        .fontWeight(.semibold)
                }
            }
            .foregroundColor(.white)
            .frame(maxWidth: .infinity)
            .frame(height: 72)
            .background(isEnabled ? accentColor : Color.gray)
            .cornerRadius(16)
        }
        .disabled(!isEnabled || isLoading)
    }
}

/// Unit toggle for switching between measurement units.
struct UnitToggle: View {
    let options: [String]
    @Binding var selectedOption: String
    var accentColor: Color = CareLogColors.primary

    var body: some View {
        HStack(spacing: 8) {
            ForEach(options, id: \.self) { option in
                Button {
                    selectedOption = option
                } label: {
                    Text(option)
                        .font(.headline)
                        .foregroundColor(option == selectedOption ? .white : accentColor)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 8)
                        .background(
                            RoundedRectangle(cornerRadius: 20)
                                .fill(option == selectedOption ? accentColor : Color.clear)
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: 20)
                                .stroke(accentColor, lineWidth: 1)
                        )
                }
            }
        }
    }
}

// MARK: - Preview

#Preview {
    NavigationStack {
        BloodPressureView()
    }
}

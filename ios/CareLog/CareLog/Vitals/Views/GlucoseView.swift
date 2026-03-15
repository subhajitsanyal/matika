import SwiftUI

/// Glucose logging screen.
///
/// Single numeric input with meal timing selector.
/// LOINC code: 2339-0
struct GlucoseView: View {
    @StateObject private var viewModel = GlucoseViewModel()
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 24) {
            Spacer()
                .frame(height: 32)

            // Unit toggle
            UnitToggle(
                options: ["mg/dL", "mmol/L"],
                selectedOption: $viewModel.unit,
                accentColor: CareLogColors.glucose
            )
            .onChange(of: viewModel.unit) { _, newUnit in
                viewModel.convertUnit(to: newUnit)
            }

            Spacer()
                .frame(height: 16)

            // Glucose value input
            VitalNumericInput(
                label: nil,
                value: $viewModel.value,
                placeholder: viewModel.unit == "mg/dL" ? "100" : "5.5",
                unit: viewModel.unit,
                allowDecimal: viewModel.unit == "mmol/L",
                accentColor: CareLogColors.glucose,
                errorMessage: viewModel.valueError
            )

            Spacer()
                .frame(height: 24)

            // Meal timing selector
            MealTimingSelector(
                selectedTiming: $viewModel.mealTiming,
                accentColor: CareLogColors.glucose
            )

            Spacer()

            // Save button
            SaveButton(
                title: "Save",
                isEnabled: viewModel.canSave,
                isLoading: viewModel.isSaving,
                accentColor: CareLogColors.glucose
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
        .navigationTitle("Blood Glucose")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(CareLogColors.glucose, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
    }
}

// MARK: - Meal Timing Selector

struct MealTimingSelector: View {
    @Binding var selectedTiming: MealTiming?
    var accentColor: Color = CareLogColors.primary

    var body: some View {
        VStack(spacing: 8) {
            Text("Meal Timing (Optional)")
                .font(.subheadline)
                .foregroundColor(CareLogColors.onSurfaceVariant)

            HStack(spacing: 8) {
                ForEach(MealTiming.allCases) { timing in
                    Button {
                        if selectedTiming == timing {
                            selectedTiming = nil
                        } else {
                            selectedTiming = timing
                        }
                    } label: {
                        Text(timing.displayName)
                            .font(.subheadline)
                            .foregroundColor(timing == selectedTiming ? .white : accentColor)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 8)
                            .background(
                                RoundedRectangle(cornerRadius: 16)
                                    .fill(timing == selectedTiming ? accentColor : Color.clear)
                            )
                            .overlay(
                                RoundedRectangle(cornerRadius: 16)
                                    .stroke(accentColor, lineWidth: 1)
                            )
                    }
                }
            }
        }
    }
}

enum MealTiming: String, CaseIterable, Identifiable {
    case fasting = "fasting"
    case beforeMeal = "before_meal"
    case afterMeal = "after_meal"

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .fasting: return "Fasting"
        case .beforeMeal: return "Before Meal"
        case .afterMeal: return "After Meal"
        }
    }
}

// MARK: - Preview

#Preview {
    NavigationStack {
        GlucoseView()
    }
}

import SwiftUI

/// Threshold configuration view for relatives to set vital thresholds.
struct ThresholdConfigView: View {
    @StateObject private var viewModel = ThresholdConfigViewModel()
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ZStack {
                if viewModel.isLoading {
                    ProgressView("Loading thresholds...")
                } else if let error = viewModel.error {
                    ErrorView(message: error) {
                        viewModel.loadThresholds()
                    }
                } else {
                    ScrollView {
                        VStack(spacing: 16) {
                            // Info text
                            Text("Set threshold limits for vital readings. When readings fall outside these limits, you'll receive an alert.")
                                .font(.subheadline)
                                .foregroundColor(.secondary)
                                .padding(.horizontal)
                                .padding(.top, 8)

                            // Threshold cards
                            ForEach(viewModel.thresholds) { threshold in
                                ThresholdCard(
                                    threshold: threshold,
                                    onSave: { min, max in
                                        viewModel.updateThreshold(
                                            vitalType: threshold.vitalType,
                                            minValue: min,
                                            maxValue: max
                                        )
                                    }
                                )
                            }
                        }
                        .padding()
                    }
                }

                // Success toast
                if viewModel.showSuccess {
                    VStack {
                        Spacer()
                        SuccessToast(message: "Threshold saved successfully")
                            .padding(.bottom, 32)
                    }
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .animation(.spring(), value: viewModel.showSuccess)
                }
            }
            .navigationTitle("Threshold Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Done") {
                        dismiss()
                    }
                }
            }
            .task {
                viewModel.loadThresholds()
            }
        }
    }
}

// MARK: - Threshold Card

private struct ThresholdCard: View {
    let threshold: VitalThreshold
    let onSave: (Double?, Double?) -> Void

    @State private var minValue: String = ""
    @State private var maxValue: String = ""
    @State private var isEditing = false

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            // Header
            HStack {
                // Vital icon and name
                HStack(spacing: 12) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 12)
                            .fill(vitalColor.opacity(0.1))
                            .frame(width: 44, height: 44)

                        Text(vitalIcon)
                            .font(.title2)
                    }

                    VStack(alignment: .leading, spacing: 2) {
                        Text(threshold.vitalType.displayName)
                            .font(.headline)

                        Text(threshold.unit)
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }

                Spacer()

                // Doctor badge
                if threshold.setByDoctor {
                    HStack(spacing: 4) {
                        Image(systemName: "lock.fill")
                            .font(.caption)
                        Text("Doctor set")
                            .font(.caption)
                    }
                    .foregroundColor(CareLogColors.primary)
                }
            }

            // Input fields
            HStack(spacing: 16) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Min")
                        .font(.caption)
                        .foregroundColor(CareLogColors.warning)

                    TextField("Min", text: $minValue)
                        .keyboardType(.decimalPad)
                        .textFieldStyle(.roundedBorder)
                        .disabled(threshold.setByDoctor)
                        .onChange(of: minValue) { _, _ in
                            isEditing = true
                        }
                }

                VStack(alignment: .leading, spacing: 4) {
                    Text("Max")
                        .font(.caption)
                        .foregroundColor(CareLogColors.error)

                    TextField("Max", text: $maxValue)
                        .keyboardType(.decimalPad)
                        .textFieldStyle(.roundedBorder)
                        .disabled(threshold.setByDoctor)
                        .onChange(of: maxValue) { _, _ in
                            isEditing = true
                        }
                }
            }

            // Save button
            if isEditing && !threshold.setByDoctor {
                Button(action: {
                    let min = Double(minValue)
                    let max = Double(maxValue)
                    onSave(min, max)
                    isEditing = false
                }) {
                    Text("Save Changes")
                        .font(.subheadline)
                        .fontWeight(.semibold)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                        .background(CareLogColors.primary)
                        .foregroundColor(.white)
                        .cornerRadius(10)
                }
            }

            // Doctor override notice
            if threshold.setByDoctor {
                HStack {
                    Image(systemName: "info.circle")
                    Text("This threshold was set by a doctor and cannot be modified.")
                        .font(.caption)
                }
                .foregroundColor(CareLogColors.primary)
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(CareLogColors.primary.opacity(0.1))
                .cornerRadius(8)
            }
        }
        .padding()
        .background(Color(.systemBackground))
        .cornerRadius(16)
        .shadow(color: .black.opacity(0.05), radius: 8, y: 4)
        .onAppear {
            minValue = threshold.minValue.map { String(format: "%.1f", $0) } ?? ""
            maxValue = threshold.maxValue.map { String(format: "%.1f", $0) } ?? ""
        }
    }

    private var vitalColor: Color {
        switch threshold.vitalType {
        case .bloodPressure: return CareLogColors.bloodPressure
        case .glucose: return CareLogColors.glucose
        case .temperature: return CareLogColors.temperature
        case .weight: return CareLogColors.weight
        case .pulse: return CareLogColors.pulse
        case .spo2: return CareLogColors.spO2
        }
    }

    private var vitalIcon: String {
        switch threshold.vitalType {
        case .bloodPressure: return "❤️"
        case .glucose: return "🩸"
        case .temperature: return "🌡️"
        case .weight: return "⚖️"
        case .pulse: return "💓"
        case .spo2: return "🫁"
        }
    }
}

// MARK: - Success Toast

private struct SuccessToast: View {
    let message: String

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "checkmark.circle.fill")
            Text(message)
                .font(.subheadline)
        }
        .foregroundColor(.white)
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(CareLogColors.success)
        .cornerRadius(8)
    }
}

// MARK: - Error View

private struct ErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 48))
                .foregroundColor(.secondary)

            Text(message)
                .font(.headline)
                .multilineTextAlignment(.center)

            Button("Retry", action: onRetry)
                .buttonStyle(.borderedProminent)
        }
        .padding(32)
    }
}

// MARK: - Preview

#Preview {
    ThresholdConfigView()
}

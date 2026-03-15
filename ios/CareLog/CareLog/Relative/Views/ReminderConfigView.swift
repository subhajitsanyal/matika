import SwiftUI

/// Reminder configuration view for relatives to set vital logging reminders.
struct ReminderConfigView: View {
    @StateObject private var viewModel = ReminderConfigViewModel()
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ZStack {
                if viewModel.isLoading {
                    ProgressView("Loading reminders...")
                } else if let error = viewModel.error {
                    ErrorView(message: error) {
                        viewModel.loadReminders()
                    }
                } else {
                    ScrollView {
                        VStack(spacing: 16) {
                            // Info text
                            Text("Set how often you want to be reminded if vitals haven't been logged. You'll receive notifications when the time window passes.")
                                .font(.subheadline)
                                .foregroundColor(.secondary)
                                .padding(.horizontal)
                                .padding(.top, 8)

                            // Reminder cards
                            ForEach(viewModel.reminders) { reminder in
                                ReminderCard(
                                    reminder: reminder,
                                    onSave: { windowHours, gracePeriod, enabled in
                                        viewModel.updateReminder(
                                            vitalType: reminder.vitalType,
                                            windowHours: windowHours,
                                            gracePeriodMinutes: gracePeriod,
                                            enabled: enabled
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
                        SuccessToast(message: "Reminder saved successfully")
                            .padding(.bottom, 32)
                    }
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .animation(.spring(), value: viewModel.showSuccess)
                }
            }
            .navigationTitle("Reminder Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Done") {
                        dismiss()
                    }
                }
            }
            .task {
                viewModel.loadReminders()
            }
        }
    }
}

// MARK: - Reminder Card

private struct ReminderCard: View {
    let reminder: ReminderConfigModel
    let onSave: (Int, Int, Bool) -> Void

    @State private var windowHours: Int = 24
    @State private var gracePeriod: Int = 60
    @State private var enabled: Bool = true
    @State private var isEditing = false

    private let windowOptions = [
        (label: "8h", hours: 8),
        (label: "12h", hours: 12),
        (label: "24h", hours: 24),
        (label: "48h", hours: 48),
        (label: "1wk", hours: 168)
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            // Header with toggle
            HStack {
                // Vital icon and name
                HStack(spacing: 12) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 12)
                            .fill(vitalColor.opacity(0.1))
                            .frame(width: 44, height: 44)

                        Image(systemName: "bell.fill")
                            .foregroundColor(vitalColor)
                    }

                    VStack(alignment: .leading, spacing: 2) {
                        Text(reminder.vitalType.displayName)
                            .font(.headline)

                        Text(enabled ? "Enabled" : "Disabled")
                            .font(.caption)
                            .foregroundColor(enabled ? CareLogColors.success : .secondary)
                    }
                }

                Spacer()

                Toggle("", isOn: $enabled)
                    .labelsHidden()
                    .tint(CareLogColors.primary)
                    .onChange(of: enabled) { _, _ in
                        isEditing = true
                    }
            }

            if enabled {
                // Window selector
                VStack(alignment: .leading, spacing: 8) {
                    Text("Remind me if not logged within:")
                        .font(.subheadline)

                    HStack(spacing: 8) {
                        ForEach(windowOptions, id: \.hours) { option in
                            WindowChip(
                                label: option.label,
                                isSelected: windowHours == option.hours
                            ) {
                                windowHours = option.hours
                                isEditing = true
                            }
                        }
                    }
                }

                // Grace period slider
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text("Grace period:")
                            .font(.subheadline)

                        Spacer()

                        Text(formatGracePeriod(gracePeriod))
                            .font(.subheadline)
                            .foregroundColor(CareLogColors.primary)
                    }

                    Slider(
                        value: Binding(
                            get: { Double(gracePeriod) },
                            set: {
                                gracePeriod = Int($0)
                                isEditing = true
                            }
                        ),
                        in: 0...120,
                        step: 30
                    )
                    .tint(CareLogColors.primary)

                    Text("Extra time before sending the reminder")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }

            // Save button
            if isEditing {
                Button(action: {
                    onSave(windowHours, gracePeriod, enabled)
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
        }
        .padding()
        .background(enabled ? Color(.systemBackground) : Color(.secondarySystemBackground))
        .cornerRadius(16)
        .shadow(color: .black.opacity(0.05), radius: 8, y: 4)
        .onAppear {
            windowHours = reminder.windowHours
            gracePeriod = reminder.gracePeriodMinutes
            enabled = reminder.enabled
        }
    }

    private var vitalColor: Color {
        switch reminder.vitalType {
        case .bloodPressure: return CareLogColors.bloodPressure
        case .glucose: return CareLogColors.glucose
        case .temperature: return CareLogColors.temperature
        case .weight: return CareLogColors.weight
        case .pulse: return CareLogColors.pulse
        case .spo2: return CareLogColors.spO2
        }
    }

    private func formatGracePeriod(_ minutes: Int) -> String {
        switch minutes {
        case 0: return "No grace period"
        case 1..<60: return "\(minutes) minutes"
        case 60: return "1 hour"
        default: return "\(minutes / 60) hours"
        }
    }
}

// MARK: - Window Chip

private struct WindowChip: View {
    let label: String
    let isSelected: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            Text(label)
                .font(.caption)
                .fontWeight(isSelected ? .semibold : .regular)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(isSelected ? CareLogColors.primary : Color(.systemGray5))
                .foregroundColor(isSelected ? .white : .primary)
                .cornerRadius(16)
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
    ReminderConfigView()
}

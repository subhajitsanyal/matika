import SwiftUI

/// Patient dashboard screen.
///
/// Large-button grid layout with 6 vitals + media upload + LLM placeholder.
/// Designed for accessibility with 72pt+ touch targets and high contrast.
struct DashboardView: View {
    @StateObject private var viewModel = DashboardViewModel()
    @State private var selectedTab = 0

    var body: some View {
        TabView(selection: $selectedTab) {
            // Home Tab
            NavigationStack {
                homeContent
                    .navigationTitle("CareLog")
                    .toolbar {
                        ToolbarItem(placement: .topBarTrailing) {
                            HStack(spacing: 8) {
                                if viewModel.pendingSyncCount > 0 {
                                    SyncBadge(count: viewModel.pendingSyncCount)
                                }
                                NavigationLink(destination: SettingsView()) {
                                    Image(systemName: "gearshape.fill")
                                        .foregroundColor(CareLogColors.primary)
                                }
                            }
                        }
                        ToolbarItem(placement: .topBarLeading) {
                            if let name = viewModel.patientName {
                                Text(name)
                                    .font(.subheadline)
                                    .foregroundColor(CareLogColors.onSurfaceVariant)
                            }
                        }
                    }
            }
            .tabItem {
                Label("Home", systemImage: "house.fill")
            }
            .tag(0)

            // History Tab
            NavigationStack {
                HistoryView()
                    .navigationTitle("History")
            }
            .tabItem {
                Label("History", systemImage: "chart.line.uptrend.xyaxis")
            }
            .tag(1)

            // Alerts Tab
            NavigationStack {
                AlertsView()
                    .navigationTitle("Alerts")
            }
            .tabItem {
                Label("Alerts", systemImage: "bell.fill")
            }
            .tag(2)
        }
        .tint(CareLogColors.primary)
    }

    // MARK: - Home Content

    private var homeContent: some View {
        ScrollView {
            VStack(spacing: 16) {
                // Missed reminder banner
                if let reminder = viewModel.missedReminder {
                    MissedReminderBanner(
                        vitalType: reminder,
                        onDismiss: { viewModel.dismissReminder() },
                        onLogNow: { /* Navigate to vital */ }
                    )
                }

                // Vital buttons grid
                LazyVGrid(
                    columns: [
                        GridItem(.flexible(), spacing: 16),
                        GridItem(.flexible(), spacing: 16)
                    ],
                    spacing: 16
                ) {
                    ForEach(VitalType.dashboardItems) { vitalType in
                        NavigationLink(destination: destinationView(for: vitalType)) {
                            VitalButton(
                                vitalType: vitalType,
                                lastValue: viewModel.lastValues[vitalType]
                            )
                        }
                        .buttonStyle(PlainButtonStyle())
                    }
                }
                .padding(.horizontal, 16)
            }
            .padding(.vertical, 16)
        }
        .background(CareLogColors.background)
        .refreshable {
            viewModel.refreshData()
        }
    }

    // MARK: - Navigation Destinations

    @ViewBuilder
    private func destinationView(for vitalType: VitalType) -> some View {
        switch vitalType {
        case .bloodPressure:
            BloodPressureInputView()
        case .glucose:
            GlucoseInputView()
        case .temperature:
            TemperatureInputView()
        case .weight:
            WeightInputView()
        case .pulse:
            PulseInputView()
        case .spO2:
            SpO2InputView()
        case .upload:
            MediaUploadView()
        case .chat:
            HealthChatView()
        }
    }
}

// MARK: - Sync Badge

struct SyncBadge: View {
    let count: Int

    var body: some View {
        Text("\(count)")
            .font(.caption2)
            .fontWeight(.bold)
            .foregroundColor(.white)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(CareLogColors.warning)
            .clipShape(Capsule())
    }
}

// MARK: - Missed Reminder Banner

struct MissedReminderBanner: View {
    let vitalType: VitalType
    let onDismiss: () -> Void
    let onLogNow: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.title2)
                .foregroundColor(CareLogColors.warning)

            VStack(alignment: .leading, spacing: 2) {
                Text("Reminder")
                    .font(.headline)
                    .foregroundColor(CareLogColors.warning)
                Text("Time to log your \(vitalType.displayName)")
                    .font(.subheadline)
                    .foregroundColor(CareLogColors.onSurface)
            }

            Spacer()

            Button("Log Now") {
                onLogNow()
            }
            .foregroundColor(CareLogColors.primary)

            Button {
                onDismiss()
            } label: {
                Image(systemName: "xmark")
                    .foregroundColor(CareLogColors.onSurfaceVariant)
            }
        }
        .padding(16)
        .background(CareLogColors.warning.opacity(0.15))
        .cornerRadius(12)
        .padding(.horizontal, 16)
    }
}

// MARK: - Vital Button

struct VitalButton: View {
    let vitalType: VitalType
    let lastValue: String?

    var body: some View {
        VStack(spacing: 12) {
            // Icon container
            ZStack {
                RoundedRectangle(cornerRadius: 16)
                    .fill(vitalType.color)
                    .frame(width: 64, height: 64)

                Image(systemName: vitalType.iconName)
                    .font(.system(size: 28, weight: .medium))
                    .foregroundColor(.white)
            }

            // Label
            Text(vitalType.label)
                .font(.headline)
                .multilineTextAlignment(.center)
                .foregroundColor(CareLogColors.onSurface)
                .lineLimit(2)
                .minimumScaleFactor(0.8)

            // Last value
            if let value = lastValue {
                Text(value)
                    .font(.caption)
                    .foregroundColor(CareLogColors.onSurfaceVariant)
            }
        }
        .frame(maxWidth: .infinity)
        .aspectRatio(1, contentMode: .fit)
        .padding(16)
        .background(vitalType.color.opacity(0.12))
        .cornerRadius(16)
        .shadow(color: .black.opacity(0.05), radius: 2, x: 0, y: 1)
    }
}

// MARK: - Placeholder Views

struct SettingsView: View {
    var body: some View {
        Text("Settings")
            .navigationTitle("Settings")
    }
}

struct HistoryView: View {
    var body: some View {
        Text("History View")
    }
}

struct AlertsView: View {
    var body: some View {
        Text("Alerts View")
    }
}

struct BloodPressureInputView: View {
    var body: some View {
        Text("Blood Pressure Input")
            .navigationTitle("Blood Pressure")
    }
}

struct GlucoseInputView: View {
    var body: some View {
        Text("Glucose Input")
            .navigationTitle("Blood Glucose")
    }
}

struct TemperatureInputView: View {
    var body: some View {
        Text("Temperature Input")
            .navigationTitle("Temperature")
    }
}

struct WeightInputView: View {
    var body: some View {
        Text("Weight Input")
            .navigationTitle("Weight")
    }
}

struct PulseInputView: View {
    var body: some View {
        Text("Pulse Input")
            .navigationTitle("Heart Rate")
    }
}

struct SpO2InputView: View {
    var body: some View {
        Text("SpO2 Input")
            .navigationTitle("Oxygen Level")
    }
}

struct MediaUploadView: View {
    var body: some View {
        Text("Media Upload")
            .navigationTitle("Upload Media")
    }
}

struct HealthChatView: View {
    var body: some View {
        Text("Health Chat")
            .navigationTitle("Health Chat")
    }
}

// MARK: - Preview

#Preview {
    DashboardView()
}

import SwiftUI

/// Relative dashboard showing patient vitals summary.
struct RelativeDashboardView: View {
    @StateObject private var viewModel = RelativeDashboardViewModel()
    @State private var selectedTab = 0

    var body: some View {
        TabView(selection: $selectedTab) {
            // Home Tab
            NavigationStack {
                DashboardContent(viewModel: viewModel)
                    .navigationTitle("CareLog")
                    .navigationBarTitleDisplayMode(.large)
                    .toolbar {
                        ToolbarItem(placement: .navigationBarTrailing) {
                            HStack {
                                NavigationLink(destination: AlertInboxView()) {
                                    AlertBadgeView(count: viewModel.unreadAlertCount)
                                }

                                NavigationLink(destination: RelativeSettingsView()) {
                                    Image(systemName: "gearshape")
                                }
                            }
                        }
                    }
                    .refreshable {
                        await viewModel.refresh()
                    }
            }
            .tabItem {
                Label("Home", systemImage: "house.fill")
            }
            .tag(0)

            // Trends Tab
            NavigationStack {
                TrendsView()
            }
            .tabItem {
                Label("Trends", systemImage: "chart.line.uptrend.xyaxis")
            }
            .tag(1)

            // Care Team Tab
            NavigationStack {
                CareTeamView()
            }
            .tabItem {
                Label("Team", systemImage: "person.3.fill")
            }
            .tag(2)
        }
        .task {
            await viewModel.loadPatientSummary()
        }
    }
}

// MARK: - Dashboard Content

private struct DashboardContent: View {
    @ObservedObject var viewModel: RelativeDashboardViewModel

    var body: some View {
        Group {
            if viewModel.isLoading && viewModel.patientSummary == nil {
                LoadingView()
            } else if let error = viewModel.error {
                ErrorView(
                    message: error,
                    onRetry: {
                        Task { await viewModel.refresh() }
                    }
                )
            } else if let summary = viewModel.patientSummary {
                VitalsSummaryList(summary: summary)
            } else {
                EmptyStateView()
            }
        }
    }
}

// MARK: - Vitals Summary List

private struct VitalsSummaryList: View {
    let summary: PatientSummary

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 16) {
                // Patient header
                PatientHeaderCard(
                    name: summary.patientName,
                    lastActivity: summary.lastActivityTime
                )

                // Vital cards
                ForEach(VitalTypeAPI.allCases, id: \.self) { vitalType in
                    VitalSummaryCard(
                        vitalType: vitalType,
                        vital: summary.latestVitals[vitalType.rawValue.lowercased()]
                    )
                }
            }
            .padding()
        }
    }
}

// MARK: - Patient Header Card

private struct PatientHeaderCard: View {
    let name: String
    let lastActivity: Date?

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text("Monitoring")
                    .font(.caption)
                    .foregroundColor(.secondary)
                Text(name)
                    .font(.title2)
                    .fontWeight(.semibold)
            }

            Spacer()

            if let lastActivity = lastActivity {
                VStack(alignment: .trailing, spacing: 4) {
                    Text("Last Activity")
                        .font(.caption)
                        .foregroundColor(.secondary)
                    Text(timeAgo(from: lastActivity))
                        .font(.subheadline)
                        .fontWeight(.medium)
                }
            }
        }
        .padding()
        .background(CareLogColors.primary.opacity(0.1))
        .cornerRadius(12)
    }

    private func timeAgo(from date: Date) -> String {
        let interval = Date().timeIntervalSince(date)
        let minutes = Int(interval / 60)
        let hours = Int(interval / 3600)
        let days = Int(interval / 86400)

        if minutes < 1 {
            return "Just now"
        } else if minutes < 60 {
            return "\(minutes) min ago"
        } else if hours < 24 {
            return "\(hours) hr ago"
        } else {
            return "\(days) days ago"
        }
    }
}

// MARK: - Vital Summary Card

private struct VitalSummaryCard: View {
    let vitalType: VitalTypeAPI
    let vital: LatestVital?

    var body: some View {
        NavigationLink(destination: VitalDetailView(vitalType: vitalType)) {
            HStack(spacing: 16) {
                // Icon
                ZStack {
                    Circle()
                        .fill(vitalColor.opacity(0.15))
                        .frame(width: 56, height: 56)

                    Image(systemName: vitalType.iconName)
                        .font(.title2)
                        .foregroundColor(vitalColor)
                }

                // Content
                VStack(alignment: .leading, spacing: 4) {
                    Text(vitalType.displayName)
                        .font(.headline)
                        .foregroundColor(.primary)

                    if let vital = vital {
                        HStack(alignment: .firstTextBaseline, spacing: 4) {
                            Text(formattedValue)
                                .font(.title)
                                .fontWeight(.bold)
                                .foregroundColor(statusColor)

                            Text(vital.unit)
                                .font(.subheadline)
                                .foregroundColor(.secondary)
                        }

                        Text(formattedTimestamp)
                            .font(.caption)
                            .foregroundColor(.secondary)
                    } else {
                        Text("No data")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                    }
                }

                Spacer()

                // Status indicator
                if let vital = vital {
                    Circle()
                        .fill(statusColor)
                        .frame(width: 12, height: 12)
                }

                Image(systemName: "chevron.right")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            .padding()
            .background(Color(.systemBackground))
            .cornerRadius(16)
            .shadow(color: .black.opacity(0.05), radius: 8, y: 4)
        }
        .buttonStyle(.plain)
    }

    private var vitalColor: Color {
        switch vitalType {
        case .bloodPressure: return CareLogColors.bloodPressure
        case .glucose: return CareLogColors.glucose
        case .temperature: return CareLogColors.temperature
        case .weight: return CareLogColors.weight
        case .pulse: return CareLogColors.pulse
        case .spo2: return CareLogColors.spO2
        }
    }

    private var statusColor: Color {
        guard let vital = vital else { return .gray }
        switch vital.status {
        case .normal: return CareLogColors.success
        case .low, .high: return CareLogColors.warning
        case .critical: return CareLogColors.error
        }
    }

    private var formattedValue: String {
        guard let vital = vital else { return "-" }
        switch vitalType {
        case .bloodPressure:
            let systolic = Int(vital.value)
            let diastolic = Int(vital.secondaryValue ?? 0)
            return "\(systolic)/\(diastolic)"
        case .temperature, .weight:
            return String(format: "%.1f", vital.value)
        default:
            return "\(Int(vital.value))"
        }
    }

    private var formattedTimestamp: String {
        guard let vital = vital else { return "" }
        let formatter = DateFormatter()
        formatter.dateFormat = "MMM d, h:mm a"
        return formatter.string(from: vital.timestamp)
    }
}

// MARK: - Alert Badge View

private struct AlertBadgeView: View {
    let count: Int

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Image(systemName: "bell.fill")

            if count > 0 {
                Text(count > 99 ? "99+" : "\(count)")
                    .font(.caption2)
                    .fontWeight(.bold)
                    .foregroundColor(.white)
                    .padding(4)
                    .background(CareLogColors.error)
                    .clipShape(Circle())
                    .offset(x: 8, y: -8)
            }
        }
    }
}

// MARK: - Supporting Views

private struct LoadingView: View {
    var body: some View {
        VStack(spacing: 16) {
            ProgressView()
                .scaleEffect(1.5)
            Text("Loading patient data...")
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

private struct ErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 48))
                .foregroundColor(CareLogColors.error)

            Text("Something went wrong")
                .font(.title2)
                .fontWeight(.semibold)

            Text(message)
                .font(.body)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)

            Button("Retry", action: onRetry)
                .buttonStyle(.borderedProminent)
        }
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

private struct EmptyStateView: View {
    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "person.crop.circle.badge.questionmark")
                .font(.system(size: 48))
                .foregroundColor(.secondary)

            Text("No patient data")
                .font(.title2)
                .fontWeight(.semibold)

            Text("Patient vital data will appear here once logged.")
                .font(.body)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Placeholder Views

struct AlertInboxView: View {
    var body: some View {
        Text("Alert Inbox")
            .navigationTitle("Alerts")
    }
}

struct RelativeSettingsView: View {
    var body: some View {
        Text("Settings")
            .navigationTitle("Settings")
    }
}

struct TrendsView: View {
    var body: some View {
        Text("Trends View")
            .navigationTitle("Trends")
    }
}

struct CareTeamView: View {
    var body: some View {
        Text("Care Team")
            .navigationTitle("Care Team")
    }
}

struct VitalDetailView: View {
    let vitalType: VitalTypeAPI

    var body: some View {
        Text("\(vitalType.displayName) Details")
            .navigationTitle(vitalType.displayName)
    }
}

// MARK: - Preview

#Preview {
    RelativeDashboardView()
}

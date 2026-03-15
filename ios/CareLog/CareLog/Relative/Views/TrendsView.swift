import SwiftUI
import Charts

/// Trends view showing time-series charts for vitals.
struct TrendsView: View {
    @StateObject private var viewModel = TrendsViewModel()

    var body: some View {
        VStack(spacing: 0) {
            // Date range selector
            DateRangeSelector(
                selectedRange: $viewModel.selectedDateRange,
                onChange: { viewModel.loadData() }
            )

            // Vital type tabs
            VitalTypePicker(
                selectedType: $viewModel.selectedVitalType,
                onChange: { viewModel.loadData() }
            )

            // Content
            if viewModel.isLoading {
                Spacer()
                ProgressView("Loading data...")
                Spacer()
            } else if viewModel.observations.isEmpty {
                Spacer()
                EmptyDataView()
                Spacer()
            } else {
                ScrollView {
                    VStack(spacing: 16) {
                        // Chart card
                        VitalChartCard(
                            vitalType: viewModel.selectedVitalType,
                            observations: viewModel.observations,
                            threshold: viewModel.threshold
                        )

                        // Recent readings
                        RecentReadingsSection(
                            observations: viewModel.observations
                        )
                    }
                    .padding()
                }
            }
        }
        .navigationTitle("Trends")
        .task {
            viewModel.loadData()
        }
    }
}

// MARK: - Date Range Selector

private struct DateRangeSelector: View {
    @Binding var selectedRange: DateRange
    let onChange: () -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(DateRange.allCases, id: \.self) { range in
                    Button(action: {
                        selectedRange = range
                        onChange()
                    }) {
                        Text(range.label)
                            .font(.subheadline)
                            .fontWeight(selectedRange == range ? .semibold : .regular)
                            .padding(.horizontal, 16)
                            .padding(.vertical, 8)
                            .background(
                                selectedRange == range
                                    ? CareLogColors.primary
                                    : Color(.systemGray5)
                            )
                            .foregroundColor(
                                selectedRange == range ? .white : .primary
                            )
                            .cornerRadius(20)
                    }
                }
            }
            .padding(.horizontal)
            .padding(.vertical, 8)
        }
    }
}

// MARK: - Vital Type Picker

private struct VitalTypePicker: View {
    @Binding var selectedType: VitalTypeAPI
    let onChange: () -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 0) {
                ForEach(VitalTypeAPI.allCases, id: \.self) { type in
                    Button(action: {
                        selectedType = type
                        onChange()
                    }) {
                        VStack(spacing: 4) {
                            Text(type.displayName)
                                .font(.subheadline)
                                .foregroundColor(
                                    selectedType == type ? CareLogColors.primary : .secondary
                                )

                            Rectangle()
                                .fill(
                                    selectedType == type
                                        ? CareLogColors.primary
                                        : Color.clear
                                )
                                .frame(height: 2)
                        }
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                    }
                }
            }
        }
        .background(Color(.systemBackground))
    }
}

// MARK: - Vital Chart Card

private struct VitalChartCard: View {
    let vitalType: VitalTypeAPI
    let observations: [VitalObservation]
    let threshold: VitalThreshold?

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            // Header
            HStack {
                Text(vitalType.displayName)
                    .font(.headline)

                Spacer()

                if let latest = observations.last {
                    Text("Latest: \(formattedValue(latest))")
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                }
            }

            // Chart
            Chart {
                ForEach(observations) { observation in
                    LineMark(
                        x: .value("Time", observation.timestamp),
                        y: .value("Value", observation.value)
                    )
                    .foregroundStyle(vitalColor)
                    .interpolationMethod(.catmullRom)

                    PointMark(
                        x: .value("Time", observation.timestamp),
                        y: .value("Value", observation.value)
                    )
                    .foregroundStyle(vitalColor)
                    .symbolSize(30)
                }

                // Threshold lines
                if let threshold = threshold {
                    if let min = threshold.minValue {
                        RuleMark(y: .value("Min", min))
                            .foregroundStyle(CareLogColors.warning.opacity(0.5))
                            .lineStyle(StrokeStyle(lineWidth: 1, dash: [5, 5]))
                            .annotation(position: .leading, alignment: .leading) {
                                Text("Min")
                                    .font(.caption2)
                                    .foregroundColor(CareLogColors.warning)
                            }
                    }

                    if let max = threshold.maxValue {
                        RuleMark(y: .value("Max", max))
                            .foregroundStyle(CareLogColors.error.opacity(0.5))
                            .lineStyle(StrokeStyle(lineWidth: 1, dash: [5, 5]))
                            .annotation(position: .leading, alignment: .leading) {
                                Text("Max")
                                    .font(.caption2)
                                    .foregroundColor(CareLogColors.error)
                            }
                    }
                }
            }
            .frame(height: 200)
            .chartXAxis {
                AxisMarks(values: .automatic(desiredCount: 5)) { value in
                    AxisValueLabel(format: .dateTime.month().day())
                }
            }
            .chartYAxis {
                AxisMarks(position: .leading)
            }

            // Legend
            if let threshold = threshold {
                HStack(spacing: 16) {
                    if let min = threshold.minValue {
                        LegendItem(color: CareLogColors.warning, label: "Min: \(Int(min))")
                    }
                    if let max = threshold.maxValue {
                        LegendItem(color: CareLogColors.error, label: "Max: \(Int(max))")
                    }
                }
            }
        }
        .padding()
        .background(Color(.systemBackground))
        .cornerRadius(16)
        .shadow(color: .black.opacity(0.05), radius: 8, y: 4)
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

    private func formattedValue(_ observation: VitalObservation) -> String {
        switch vitalType {
        case .bloodPressure:
            let systolic = Int(observation.value)
            let diastolic = Int(observation.secondaryValue ?? 0)
            return "\(systolic)/\(diastolic) \(observation.unit)"
        case .temperature, .weight:
            return String(format: "%.1f %@", observation.value, observation.unit)
        default:
            return "\(Int(observation.value)) \(observation.unit)"
        }
    }
}

// MARK: - Legend Item

private struct LegendItem: View {
    let color: Color
    let label: String

    var body: some View {
        HStack(spacing: 4) {
            Rectangle()
                .fill(color)
                .frame(width: 12, height: 3)
            Text(label)
                .font(.caption)
                .foregroundColor(.secondary)
        }
    }
}

// MARK: - Recent Readings Section

private struct RecentReadingsSection: View {
    let observations: [VitalObservation]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Recent Readings")
                .font(.headline)

            ForEach(observations.suffix(10).reversed()) { observation in
                ObservationRow(observation: observation)
            }
        }
    }
}

// MARK: - Observation Row

private struct ObservationRow: View {
    let observation: VitalObservation

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text(formattedValue)
                    .font(.headline)
                    .foregroundColor(statusColor)

                if let performer = observation.performerName {
                    Text(performer)
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }

            Spacer()

            VStack(alignment: .trailing, spacing: 4) {
                Text(formattedDate)
                    .font(.caption)
                    .foregroundColor(.secondary)

                Text(formattedTime)
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
        }
        .padding()
        .background(Color(.secondarySystemBackground))
        .cornerRadius(12)
    }

    private var formattedValue: String {
        switch observation.vitalType {
        case .bloodPressure:
            let systolic = Int(observation.value)
            let diastolic = Int(observation.secondaryValue ?? 0)
            return "\(systolic)/\(diastolic) \(observation.unit)"
        case .temperature, .weight:
            return String(format: "%.1f %@", observation.value, observation.unit)
        default:
            return "\(Int(observation.value)) \(observation.unit)"
        }
    }

    private var statusColor: Color {
        switch observation.status {
        case .normal: return CareLogColors.success
        case .low, .high: return CareLogColors.warning
        case .critical: return CareLogColors.error
        }
    }

    private var formattedDate: String {
        let formatter = DateFormatter()
        formatter.dateFormat = "MMM d"
        return formatter.string(from: observation.timestamp)
    }

    private var formattedTime: String {
        let formatter = DateFormatter()
        formatter.dateFormat = "h:mm a"
        return formatter.string(from: observation.timestamp)
    }
}

// MARK: - Empty Data View

private struct EmptyDataView: View {
    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "chart.line.uptrend.xyaxis")
                .font(.system(size: 48))
                .foregroundColor(.secondary)

            Text("No data for this period")
                .font(.headline)

            Text("Select a different date range or vital type.")
                .font(.subheadline)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding(32)
    }
}

// MARK: - Date Range Enum

enum DateRange: String, CaseIterable {
    case week = "7 Days"
    case month = "30 Days"
    case quarter = "90 Days"

    var label: String { rawValue }

    var days: Int {
        switch self {
        case .week: return 7
        case .month: return 30
        case .quarter: return 90
        }
    }
}

// MARK: - Preview

#Preview {
    NavigationStack {
        TrendsView()
    }
}

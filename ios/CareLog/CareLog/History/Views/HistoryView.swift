import SwiftUI

/// Vital history list screen.
///
/// Chronological list showing: value, timestamp, recorder identity, sync status.
/// Filterable by vital type and date range.
struct HistoryView: View {
    @StateObject private var viewModel = HistoryViewModel()

    var body: some View {
        VStack(spacing: 0) {
            // Vital type filter
            VitalTypeFilterBar(
                selectedType: $viewModel.selectedVitalType,
                onTypeSelected: { type in
                    viewModel.selectVitalType(type)
                }
            )

            // Date range filter (if expanded)
            if viewModel.showDateFilter {
                DateRangeFilterView(
                    startDate: $viewModel.startDate,
                    endDate: $viewModel.endDate,
                    onClear: { viewModel.clearDateFilter() }
                )
            }

            // Content
            if viewModel.isLoading {
                Spacer()
                ProgressView()
                Spacer()
            } else if viewModel.entries.isEmpty {
                EmptyHistoryView()
            } else {
                List(viewModel.entries) { entry in
                    HistoryEntryRow(entry: entry)
                }
                .listStyle(.plain)
            }
        }
        .navigationTitle("History")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    viewModel.toggleDateFilter()
                } label: {
                    Image(systemName: "calendar")
                }
            }
        }
    }
}

// MARK: - Vital Type Filter Bar

struct VitalTypeFilterBar: View {
    @Binding var selectedType: DashboardItem?
    let onTypeSelected: (DashboardItem?) -> Void

    private let vitalTypes: [DashboardItem] = DashboardItem.vitals

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                // "All" chip
                VitalFilterChip(
                    title: "All",
                    isSelected: selectedType == nil,
                    color: CareLogColors.primary
                ) {
                    selectedType = nil
                    onTypeSelected(nil)
                }

                // Vital type chips
                ForEach(vitalTypes) { type in
                    VitalFilterChip(
                        title: type.displayName,
                        isSelected: selectedType == type,
                        color: type.color
                    ) {
                        selectedType = type
                        onTypeSelected(type)
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
        }
        .background(Color(.systemBackground))
    }
}

private struct VitalFilterChip: View {
    let title: String
    let isSelected: Bool
    let color: Color
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.subheadline)
                .fontWeight(.medium)
                .foregroundColor(isSelected ? .white : color)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(isSelected ? color : Color.clear)
                .cornerRadius(16)
                .overlay(
                    RoundedRectangle(cornerRadius: 16)
                        .stroke(color, lineWidth: 1)
                )
        }
    }
}

// MARK: - Date Range Filter

struct DateRangeFilterView: View {
    @Binding var startDate: Date?
    @Binding var endDate: Date?
    let onClear: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            DatePicker(
                "From",
                selection: Binding(
                    get: { startDate ?? Date() },
                    set: { startDate = $0 }
                ),
                displayedComponents: .date
            )
            .labelsHidden()

            Text("to")
                .foregroundColor(CareLogColors.onSurfaceVariant)

            DatePicker(
                "To",
                selection: Binding(
                    get: { endDate ?? Date() },
                    set: { endDate = $0 }
                ),
                displayedComponents: .date
            )
            .labelsHidden()

            if startDate != nil || endDate != nil {
                Button {
                    onClear()
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundColor(CareLogColors.onSurfaceVariant)
                }
            }
        }
        .padding()
        .background(Color(.secondarySystemBackground))
    }
}

// MARK: - Empty State

struct EmptyHistoryView: View {
    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "clock.arrow.circlepath")
                .font(.system(size: 64))
                .foregroundColor(CareLogColors.onSurfaceVariant)

            Text("No history yet")
                .font(.headline)
                .foregroundColor(CareLogColors.onSurfaceVariant)

            Text("Start logging your vitals")
                .font(.subheadline)
                .foregroundColor(CareLogColors.onSurfaceVariant)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - History Entry Row

struct HistoryEntryRow: View {
    let entry: HistoryEntry

    var body: some View {
        HStack(spacing: 16) {
            // Vital type indicator
            ZStack {
                Circle()
                    .fill(entry.vitalType.color)
                    .frame(width: 48, height: 48)

                Image(systemName: entry.vitalType.iconName)
                    .font(.title3)
                    .foregroundColor(.white)
            }

            // Value and details
            VStack(alignment: .leading, spacing: 4) {
                Text(entry.displayValue)
                    .font(.title2)
                    .fontWeight(.semibold)

                Text(entry.vitalType.displayName)
                    .font(.subheadline)
                    .foregroundColor(CareLogColors.onSurfaceVariant)

                HStack {
                    Text(formatDateTime(entry.timestamp))
                        .font(.caption)
                        .foregroundColor(CareLogColors.onSurfaceVariant)

                    if let performer = entry.performerName {
                        Text("\u{2022} \(performer)")
                            .font(.caption)
                            .foregroundColor(CareLogColors.onSurfaceVariant)
                    }
                }
            }

            Spacer()

            // Sync status
            SyncStatusIcon(status: entry.syncStatus)
        }
        .padding(.vertical, 8)
    }

    private func formatDateTime(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }
}

// MARK: - Sync Status Icon

private struct SyncStatusIcon: View {
    let status: SyncStatus

    var body: some View {
        let (iconName, color) = statusInfo

        Image(systemName: iconName)
            .foregroundColor(color)
            .font(.title3)
    }

    private var statusInfo: (String, Color) {
        switch status {
        case .synced:
            return ("checkmark.icloud.fill", CareLogColors.success)
        case .pending:
            return ("icloud.and.arrow.up", CareLogColors.warning)
        case .failed:
            return ("exclamationmark.icloud.fill", CareLogColors.error)
        case .modified:
            return ("arrow.triangle.2.circlepath.icloud", CareLogColors.info)
        }
    }
}

// MARK: - Preview

#Preview {
    NavigationStack {
        HistoryView()
    }
}

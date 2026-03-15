import { useState, useEffect, useMemo } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import { format, subDays, parseISO } from 'date-fns';
import { getObservations, getThresholds, addObservationNote, Observation, Threshold } from '../../services/api';
import { VITAL_TYPES, VITAL_CONFIG, DATE_RANGES, DATE_RANGE_LABELS } from '../../config/constants';
import LoadingSpinner from '../LoadingSpinner';
import AnnotationModal from './AnnotationModal';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler);

interface VitalsTabProps {
  patientId: string;
}

export default function VitalsTab({ patientId }: VitalsTabProps) {
  const [observations, setObservations] = useState<Observation[]>([]);
  const [thresholds, setThresholds] = useState<Threshold[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedVital, setSelectedVital] = useState<string>(VITAL_TYPES.BLOOD_PRESSURE);
  const [dateRange, setDateRange] = useState<string>(DATE_RANGES.MONTH);
  const [selectedObservation, setSelectedObservation] = useState<Observation | null>(null);

  useEffect(() => {
    loadData();
  }, [patientId, selectedVital, dateRange]);

  async function loadData() {
    try {
      setIsLoading(true);
      const days = parseInt(dateRange.replace('d', ''));
      const startDate = subDays(new Date(), days).toISOString();

      const [obsData, thresholdData] = await Promise.all([
        getObservations(patientId, {
          vitalType: selectedVital,
          startDate,
          limit: 500,
        }),
        getThresholds(patientId),
      ]);

      setObservations(obsData.observations);
      setThresholds(thresholdData);
    } catch (error) {
      console.error('Failed to load vitals:', error);
    } finally {
      setIsLoading(false);
    }
  }

  const currentThreshold = useMemo(() => {
    return thresholds.find((t) => t.vitalType === selectedVital);
  }, [thresholds, selectedVital]);

  const chartData = useMemo(() => {
    const config = VITAL_CONFIG[selectedVital as keyof typeof VITAL_CONFIG];
    const sortedObs = [...observations].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    const labels = sortedObs.map((o) => format(parseISO(o.timestamp), 'MMM d, HH:mm'));

    if (selectedVital === VITAL_TYPES.BLOOD_PRESSURE) {
      return {
        labels,
        datasets: [
          {
            label: 'Systolic',
            data: sortedObs.map((o) => o.systolic || 0),
            borderColor: '#ef4444',
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            fill: false,
            tension: 0.3,
          },
          {
            label: 'Diastolic',
            data: sortedObs.map((o) => o.diastolic || 0),
            borderColor: '#3b82f6',
            backgroundColor: 'rgba(59, 130, 246, 0.1)',
            fill: false,
            tension: 0.3,
          },
        ],
      };
    }

    return {
      labels,
      datasets: [
        {
          label: config.label,
          data: sortedObs.map((o) => o.value),
          borderColor: config.color,
          backgroundColor: `${config.color}20`,
          fill: true,
          tension: 0.3,
        },
      ],
    };
  }, [observations, selectedVital]);

  const chartOptions = useMemo(() => {
    const annotations: Record<string, unknown>[] = [];

    if (currentThreshold) {
      if (currentThreshold.minValue !== null) {
        annotations.push({
          type: 'line',
          yMin: currentThreshold.minValue,
          yMax: currentThreshold.minValue,
          borderColor: '#f59e0b',
          borderWidth: 2,
          borderDash: [5, 5],
          label: {
            content: `Min: ${currentThreshold.minValue}`,
            display: true,
          },
        });
      }
      if (currentThreshold.maxValue !== null) {
        annotations.push({
          type: 'line',
          yMin: currentThreshold.maxValue,
          yMax: currentThreshold.maxValue,
          borderColor: '#ef4444',
          borderWidth: 2,
          borderDash: [5, 5],
          label: {
            content: `Max: ${currentThreshold.maxValue}`,
            display: true,
          },
        });
      }
    }

    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'top' as const,
        },
        tooltip: {
          mode: 'index' as const,
          intersect: false,
        },
      },
      scales: {
        y: {
          beginAtZero: false,
        },
      },
    };
  }, [currentThreshold]);

  async function handleAddNote(note: string) {
    if (!selectedObservation) return;

    try {
      await addObservationNote(patientId, selectedObservation.id, note);
      setSelectedObservation(null);
      loadData();
    } catch (error) {
      console.error('Failed to add note:', error);
    }
  }

  const vitalTypes = Object.entries(VITAL_CONFIG).map(([key, config]) => ({
    value: key,
    label: config.label,
    color: config.color,
  }));

  return (
    <div>
      {/* Filters */}
      <div className="flex flex-wrap gap-4 mb-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Vital Type</label>
          <select
            value={selectedVital}
            onChange={(e) => setSelectedVital(e.target.value)}
            className="input-field"
          >
            {vitalTypes.map((vt) => (
              <option key={vt.value} value={vt.value}>
                {vt.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Date Range</label>
          <select
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value)}
            className="input-field"
          >
            {Object.entries(DATE_RANGE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <LoadingSpinner size="lg" />
        </div>
      ) : observations.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-gray-600">No observations found for this period.</p>
        </div>
      ) : (
        <>
          {/* Chart */}
          <div className="card mb-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              {VITAL_CONFIG[selectedVital as keyof typeof VITAL_CONFIG]?.label} Trend
            </h3>
            <div className="h-80">
              <Line data={chartData} options={chartOptions} />
            </div>
            {currentThreshold && (
              <div className="mt-4 flex items-center space-x-4 text-sm text-gray-500">
                <span>Thresholds:</span>
                {currentThreshold.minValue !== null && (
                  <span className="text-yellow-600">Min: {currentThreshold.minValue}</span>
                )}
                {currentThreshold.maxValue !== null && (
                  <span className="text-red-600">Max: {currentThreshold.maxValue}</span>
                )}
                <span className="text-gray-400">
                  (Set by {currentThreshold.setBy}: {currentThreshold.setByName})
                </span>
              </div>
            )}
          </div>

          {/* Observation list */}
          <div className="card">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Observations</h3>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead>
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Date/Time
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Value
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Recorded By
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Notes
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {observations.map((obs) => {
                    const config = VITAL_CONFIG[obs.vitalType as keyof typeof VITAL_CONFIG];
                    const isOutOfRange =
                      currentThreshold &&
                      ((currentThreshold.minValue !== null && obs.value < currentThreshold.minValue) ||
                        (currentThreshold.maxValue !== null && obs.value > currentThreshold.maxValue));

                    return (
                      <tr key={obs.id} className={isOutOfRange ? 'bg-red-50' : ''}>
                        <td className="px-4 py-3 text-sm text-gray-900">
                          {format(parseISO(obs.timestamp), 'MMM d, yyyy HH:mm')}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          <span
                            className={`font-medium ${isOutOfRange ? 'text-red-600' : 'text-gray-900'}`}
                          >
                            {obs.vitalType === VITAL_TYPES.BLOOD_PRESSURE
                              ? `${obs.systolic}/${obs.diastolic}`
                              : obs.value}{' '}
                            {config?.unit}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-500">
                          <div>{obs.performerName}</div>
                          <div className="text-xs text-gray-400 capitalize">{obs.performerRole}</div>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-500">
                          {obs.notes && obs.notes.length > 0 ? (
                            <ul className="list-disc list-inside">
                              {obs.notes.map((note, i) => (
                                <li key={i} className="truncate max-w-xs">
                                  {note}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm text-right">
                          <button
                            onClick={() => setSelectedObservation(obs)}
                            className="text-carelog-primary hover:underline"
                          >
                            Add Note
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Annotation modal */}
      {selectedObservation && (
        <AnnotationModal
          observation={selectedObservation}
          onClose={() => setSelectedObservation(null)}
          onSave={handleAddNote}
        />
      )}
    </div>
  );
}

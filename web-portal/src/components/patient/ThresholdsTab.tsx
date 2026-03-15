import { useState, useEffect } from 'react';
import { getThresholds, setThreshold, Threshold } from '../../services/api';
import { VITAL_TYPES, VITAL_CONFIG } from '../../config/constants';
import LoadingSpinner from '../LoadingSpinner';

interface ThresholdsTabProps {
  patientId: string;
}

interface ThresholdFormData {
  minValue: string;
  maxValue: string;
}

export default function ThresholdsTab({ patientId }: ThresholdsTabProps) {
  const [thresholds, setThresholds] = useState<Threshold[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [editingVital, setEditingVital] = useState<string | null>(null);
  const [formData, setFormData] = useState<ThresholdFormData>({ minValue: '', maxValue: '' });
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    loadThresholds();
  }, [patientId]);

  async function loadThresholds() {
    try {
      setIsLoading(true);
      const data = await getThresholds(patientId);
      setThresholds(data);
    } catch (err) {
      console.error('Failed to load thresholds:', err);
    } finally {
      setIsLoading(false);
    }
  }

  function getThresholdForVital(vitalType: string): Threshold | undefined {
    return thresholds.find((t) => t.vitalType === vitalType);
  }

  function startEditing(vitalType: string) {
    const existing = getThresholdForVital(vitalType);
    setFormData({
      minValue: existing?.minValue?.toString() || '',
      maxValue: existing?.maxValue?.toString() || '',
    });
    setEditingVital(vitalType);
    setError('');
  }

  function cancelEditing() {
    setEditingVital(null);
    setFormData({ minValue: '', maxValue: '' });
    setError('');
  }

  async function handleSave(vitalType: string) {
    const minValue = formData.minValue ? parseFloat(formData.minValue) : null;
    const maxValue = formData.maxValue ? parseFloat(formData.maxValue) : null;

    if (minValue !== null && maxValue !== null && minValue >= maxValue) {
      setError('Minimum value must be less than maximum value');
      return;
    }

    try {
      setIsSaving(true);
      await setThreshold(patientId, vitalType, minValue, maxValue);
      await loadThresholds();
      setEditingVital(null);
      setFormData({ minValue: '', maxValue: '' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save threshold');
    } finally {
      setIsSaving(false);
    }
  }

  const vitalTypes = Object.entries(VITAL_CONFIG).map(([key, config]) => ({
    type: key,
    ...config,
  }));

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div>
      <div className="card mb-6">
        <div className="flex items-start space-x-3">
          <div className="flex-shrink-0">
            <svg
              className="w-5 h-5 text-blue-500 mt-0.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <div>
            <h4 className="text-sm font-medium text-gray-900">Doctor Override</h4>
            <p className="text-sm text-gray-500">
              As a doctor, your threshold settings will override any values set by relatives or
              attendants. Alerts will be triggered based on your settings.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {vitalTypes.map((vital) => {
          const existing = getThresholdForVital(vital.type);
          const isEditing = editingVital === vital.type;

          return (
            <div key={vital.type} className="card">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div
                    className="w-10 h-10 rounded-lg flex items-center justify-center"
                    style={{ backgroundColor: `${vital.color}20` }}
                  >
                    <div
                      className="w-4 h-4 rounded-full"
                      style={{ backgroundColor: vital.color }}
                    />
                  </div>
                  <div>
                    <h3 className="text-sm font-medium text-gray-900">{vital.label}</h3>
                    <p className="text-xs text-gray-500">Unit: {vital.unit}</p>
                  </div>
                </div>

                {!isEditing && (
                  <button
                    onClick={() => startEditing(vital.type)}
                    className="text-sm text-carelog-primary hover:underline"
                  >
                    {existing ? 'Edit' : 'Set Threshold'}
                  </button>
                )}
              </div>

              {isEditing ? (
                <div className="mt-4 pt-4 border-t border-gray-100">
                  {error && (
                    <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                      {error}
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Minimum ({vital.unit})
                      </label>
                      <input
                        type="number"
                        value={formData.minValue}
                        onChange={(e) => setFormData({ ...formData, minValue: e.target.value })}
                        className="input-field"
                        placeholder="e.g., 60"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Maximum ({vital.unit})
                      </label>
                      <input
                        type="number"
                        value={formData.maxValue}
                        onChange={(e) => setFormData({ ...formData, maxValue: e.target.value })}
                        className="input-field"
                        placeholder="e.g., 120"
                      />
                    </div>
                  </div>
                  <div className="mt-4 flex justify-end space-x-2">
                    <button onClick={cancelEditing} className="btn-secondary text-sm">
                      Cancel
                    </button>
                    <button
                      onClick={() => handleSave(vital.type)}
                      disabled={isSaving}
                      className="btn-primary text-sm"
                    >
                      {isSaving ? <LoadingSpinner size="sm" /> : 'Save'}
                    </button>
                  </div>
                </div>
              ) : existing ? (
                <div className="mt-4 pt-4 border-t border-gray-100">
                  <div className="flex items-center space-x-6">
                    <div>
                      <span className="text-xs text-gray-500">Min:</span>
                      <span className="ml-1 text-sm font-medium text-gray-900">
                        {existing.minValue !== null ? `${existing.minValue} ${vital.unit}` : 'Not set'}
                      </span>
                    </div>
                    <div>
                      <span className="text-xs text-gray-500">Max:</span>
                      <span className="ml-1 text-sm font-medium text-gray-900">
                        {existing.maxValue !== null ? `${existing.maxValue} ${vital.unit}` : 'Not set'}
                      </span>
                    </div>
                    <div className="flex-1" />
                    <div className="text-right">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                          existing.setBy === 'doctor'
                            ? 'bg-blue-100 text-blue-800'
                            : 'bg-gray-100 text-gray-800'
                        }`}
                      >
                        Set by {existing.setBy}
                      </span>
                      <p className="text-xs text-gray-400 mt-1">{existing.setByName}</p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mt-4 pt-4 border-t border-gray-100">
                  <p className="text-sm text-gray-500">No threshold configured</p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

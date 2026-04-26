import { useState, useEffect } from 'react';
import type { ParameterConfig } from '../../types';
import LoadingSpinner from '../LoadingSpinner';

interface ParameterConfigFormProps {
  existingConfig?: ParameterConfig | null;
  onSubmit: (data: Partial<ParameterConfig>) => Promise<void>;
  onClose: () => void;
}

export default function ParameterConfigForm({
  existingConfig,
  onSubmit,
  onClose,
}: ParameterConfigFormProps) {
  const [parameterName, setParameterName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loincCodes, setLoincCodes] = useState('');
  const [unit, setUnit] = useState('');
  const [frequencyDays, setFrequencyDays] = useState('1');
  const [dailyDeadline, setDailyDeadline] = useState('18:00');
  const [thresholdMin, setThresholdMin] = useState('');
  const [thresholdMax, setThresholdMax] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (existingConfig) {
      setParameterName(existingConfig.parameter_name);
      setDisplayName(existingConfig.display_name);
      setLoincCodes(existingConfig.loinc_codes.join(', '));
      setUnit(existingConfig.unit);
      setFrequencyDays(existingConfig.frequency_days.toString());
      setDailyDeadline(existingConfig.daily_deadline);
      setThresholdMin(
        existingConfig.threshold_min ? existingConfig.threshold_min.join(', ') : ''
      );
      setThresholdMax(
        existingConfig.threshold_max ? existingConfig.threshold_max.join(', ') : ''
      );
    }
  }, [existingConfig]);

  function parseNumberArray(value: string): number[] | null {
    if (!value.trim()) return null;
    const parts = value.split(',').map((s) => s.trim());
    const nums = parts.map(Number);
    if (nums.some(isNaN)) return null;
    return nums;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!parameterName.trim()) {
      setError('Parameter name is required');
      return;
    }
    if (!displayName.trim()) {
      setError('Display name is required');
      return;
    }
    if (!unit.trim()) {
      setError('Unit is required');
      return;
    }
    const freq = parseInt(frequencyDays, 10);
    if (isNaN(freq) || freq < 1) {
      setError('Frequency must be a positive number');
      return;
    }

    const parsedMin = parseNumberArray(thresholdMin);
    const parsedMax = parseNumberArray(thresholdMax);

    if (thresholdMin.trim() && parsedMin === null) {
      setError('Threshold min must be comma-separated numbers');
      return;
    }
    if (thresholdMax.trim() && parsedMax === null) {
      setError('Threshold max must be comma-separated numbers');
      return;
    }

    const codes = loincCodes
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    try {
      setIsSaving(true);
      await onSubmit({
        parameter_name: parameterName.trim(),
        display_name: displayName.trim(),
        loinc_codes: codes,
        unit: unit.trim(),
        frequency_days: freq,
        daily_deadline: dailyDeadline,
        threshold_min: parsedMin,
        threshold_max: parsedMax,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save parameter config');
      setIsSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
      role="dialog"
      aria-modal="true"
      aria-label={existingConfig ? 'Edit parameter config' : 'Add parameter config'}
    >
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">
              {existingConfig ? 'Edit Parameter Config' : 'Add Parameter Config'}
            </h3>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600"
              aria-label="Close"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="p-6 space-y-4">
            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                {error}
              </div>
            )}

            <div>
              <label htmlFor="parameterName" className="block text-sm font-medium text-gray-700 mb-1">
                Parameter Name *
              </label>
              <input
                id="parameterName"
                type="text"
                value={parameterName}
                onChange={(e) => setParameterName(e.target.value)}
                className="input-field"
                placeholder="e.g., blood_pressure"
                disabled={isSaving}
              />
            </div>

            <div>
              <label htmlFor="displayName" className="block text-sm font-medium text-gray-700 mb-1">
                Display Name *
              </label>
              <input
                id="displayName"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="input-field"
                placeholder="e.g., Blood Pressure"
                disabled={isSaving}
              />
            </div>

            <div>
              <label htmlFor="loincCodes" className="block text-sm font-medium text-gray-700 mb-1">
                LOINC Codes (comma-separated)
              </label>
              <input
                id="loincCodes"
                type="text"
                value={loincCodes}
                onChange={(e) => setLoincCodes(e.target.value)}
                className="input-field"
                placeholder="e.g., 85354-9, 8480-6"
                disabled={isSaving}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="unit" className="block text-sm font-medium text-gray-700 mb-1">
                  Unit *
                </label>
                <input
                  id="unit"
                  type="text"
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                  className="input-field"
                  placeholder="e.g., mmHg"
                  disabled={isSaving}
                />
              </div>

              <div>
                <label htmlFor="frequencyDays" className="block text-sm font-medium text-gray-700 mb-1">
                  Frequency (days) *
                </label>
                <input
                  id="frequencyDays"
                  type="number"
                  min="1"
                  value={frequencyDays}
                  onChange={(e) => setFrequencyDays(e.target.value)}
                  className="input-field"
                  disabled={isSaving}
                />
              </div>
            </div>

            <div>
              <label htmlFor="dailyDeadline" className="block text-sm font-medium text-gray-700 mb-1">
                Daily Deadline
              </label>
              <input
                id="dailyDeadline"
                type="time"
                value={dailyDeadline}
                onChange={(e) => setDailyDeadline(e.target.value)}
                className="input-field"
                disabled={isSaving}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="thresholdMin" className="block text-sm font-medium text-gray-700 mb-1">
                  Threshold Min
                </label>
                <input
                  id="thresholdMin"
                  type="text"
                  value={thresholdMin}
                  onChange={(e) => setThresholdMin(e.target.value)}
                  className="input-field"
                  placeholder="e.g., 60, 90"
                  disabled={isSaving}
                />
                <p className="text-xs text-gray-500 mt-1">Comma-separated values</p>
              </div>

              <div>
                <label htmlFor="thresholdMax" className="block text-sm font-medium text-gray-700 mb-1">
                  Threshold Max
                </label>
                <input
                  id="thresholdMax"
                  type="text"
                  value={thresholdMax}
                  onChange={(e) => setThresholdMax(e.target.value)}
                  className="input-field"
                  placeholder="e.g., 120, 140"
                  disabled={isSaving}
                />
                <p className="text-xs text-gray-500 mt-1">Comma-separated values</p>
              </div>
            </div>
          </div>

          <div className="p-6 border-t border-gray-200 flex justify-end space-x-3">
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary"
              disabled={isSaving}
            >
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={isSaving}>
              {isSaving ? <LoadingSpinner size="sm" /> : existingConfig ? 'Update' : 'Add'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

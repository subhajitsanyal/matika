import { useState } from 'react';
import type { ParameterConfig } from '../../types';
import LoadingSpinner from '../LoadingSpinner';

interface ThresholdOverrideFormProps {
  config: ParameterConfig;
  onSubmit: (data: { threshold_min: number[] | null; threshold_max: number[] | null }) => Promise<void>;
  onClose: () => void;
}

export default function ThresholdOverrideForm({
  config,
  onSubmit,
  onClose,
}: ThresholdOverrideFormProps) {
  const [thresholdMin, setThresholdMin] = useState(
    config.threshold_min ? config.threshold_min.join(', ') : ''
  );
  const [thresholdMax, setThresholdMax] = useState(
    config.threshold_max ? config.threshold_max.join(', ') : ''
  );
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

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

    try {
      setIsSaving(true);
      await onSubmit({ threshold_min: parsedMin, threshold_max: parsedMax });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save thresholds');
      setIsSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
      role="dialog"
      aria-modal="true"
      aria-label="Set threshold overrides"
    >
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4">
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold">Set Thresholds</h3>
              <p className="text-sm text-gray-500 mt-1">
                {config.display_name} ({config.unit})
              </p>
            </div>
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
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <p className="text-sm text-blue-700">
                As a doctor, your threshold settings will override any existing values.
                The threshold_set_by field will be updated to your name.
              </p>
            </div>

            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                {error}
              </div>
            )}

            {config.threshold_set_by && (
              <p className="text-sm text-gray-500">
                Currently set by: <span className="font-medium">{config.threshold_set_by}</span>
              </p>
            )}

            <div>
              <label htmlFor="thresholdMin" className="block text-sm font-medium text-gray-700 mb-1">
                Minimum Threshold ({config.unit})
              </label>
              <input
                id="thresholdMin"
                type="text"
                value={thresholdMin}
                onChange={(e) => setThresholdMin(e.target.value)}
                className="input-field"
                placeholder="e.g., 60 or 60, 90"
                disabled={isSaving}
              />
              <p className="text-xs text-gray-500 mt-1">
                Comma-separated for multi-component values (e.g., systolic, diastolic)
              </p>
            </div>

            <div>
              <label htmlFor="thresholdMax" className="block text-sm font-medium text-gray-700 mb-1">
                Maximum Threshold ({config.unit})
              </label>
              <input
                id="thresholdMax"
                type="text"
                value={thresholdMax}
                onChange={(e) => setThresholdMax(e.target.value)}
                className="input-field"
                placeholder="e.g., 120 or 120, 140"
                disabled={isSaving}
              />
              <p className="text-xs text-gray-500 mt-1">
                Comma-separated for multi-component values
              </p>
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
              {isSaving ? <LoadingSpinner size="sm" /> : 'Save Thresholds'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

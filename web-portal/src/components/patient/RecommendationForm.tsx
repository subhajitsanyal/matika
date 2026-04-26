import { useState } from 'react';
import LoadingSpinner from '../LoadingSpinner';

interface RecommendationFormProps {
  onSubmit: (data: {
    parameter_name: string;
    loinc_code?: string;
    rationale: string;
    suggested_frequency_days?: number;
  }) => Promise<void>;
  onClose: () => void;
}

export default function RecommendationForm({ onSubmit, onClose }: RecommendationFormProps) {
  const [parameterName, setParameterName] = useState('');
  const [loincCode, setLoincCode] = useState('');
  const [rationale, setRationale] = useState('');
  const [frequencyDays, setFrequencyDays] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!parameterName.trim()) {
      setError('Parameter name is required');
      return;
    }
    if (!rationale.trim()) {
      setError('Rationale is required');
      return;
    }

    const freq = frequencyDays.trim() ? parseInt(frequencyDays, 10) : undefined;
    if (frequencyDays.trim() && (isNaN(freq as number) || (freq as number) < 1)) {
      setError('Frequency must be a positive number');
      return;
    }

    try {
      setIsSaving(true);
      await onSubmit({
        parameter_name: parameterName.trim(),
        loinc_code: loincCode.trim() || undefined,
        rationale: rationale.trim(),
        suggested_frequency_days: freq,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create recommendation');
      setIsSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
      role="dialog"
      aria-modal="true"
      aria-label="New recommendation"
    >
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4">
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">New Recommendation</h3>
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
              <label htmlFor="recParamName" className="block text-sm font-medium text-gray-700 mb-1">
                Parameter Name *
              </label>
              <input
                id="recParamName"
                type="text"
                value={parameterName}
                onChange={(e) => setParameterName(e.target.value)}
                className="input-field"
                placeholder="e.g., blood_pressure"
                disabled={isSaving}
              />
            </div>

            <div>
              <label htmlFor="recLoincCode" className="block text-sm font-medium text-gray-700 mb-1">
                LOINC Code (optional)
              </label>
              <input
                id="recLoincCode"
                type="text"
                value={loincCode}
                onChange={(e) => setLoincCode(e.target.value)}
                className="input-field"
                placeholder="e.g., 85354-9"
                disabled={isSaving}
              />
            </div>

            <div>
              <label htmlFor="recRationale" className="block text-sm font-medium text-gray-700 mb-1">
                Rationale *
              </label>
              <textarea
                id="recRationale"
                value={rationale}
                onChange={(e) => setRationale(e.target.value)}
                className="input-field h-24 resize-none"
                placeholder="Explain why this parameter should be monitored..."
                disabled={isSaving}
              />
            </div>

            <div>
              <label htmlFor="recFrequency" className="block text-sm font-medium text-gray-700 mb-1">
                Suggested Frequency (days, optional)
              </label>
              <input
                id="recFrequency"
                type="number"
                min="1"
                value={frequencyDays}
                onChange={(e) => setFrequencyDays(e.target.value)}
                className="input-field"
                placeholder="e.g., 7"
                disabled={isSaving}
              />
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
              {isSaving ? <LoadingSpinner size="sm" /> : 'Create Recommendation'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

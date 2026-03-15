import { useState } from 'react';
import { format, parseISO } from 'date-fns';
import { Observation } from '../../services/api';
import { VITAL_TYPES, VITAL_CONFIG } from '../../config/constants';
import LoadingSpinner from '../LoadingSpinner';

interface AnnotationModalProps {
  observation: Observation;
  onClose: () => void;
  onSave: (note: string) => Promise<void>;
}

export default function AnnotationModal({ observation, onClose, onSave }: AnnotationModalProps) {
  const [note, setNote] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  const config = VITAL_CONFIG[observation.vitalType as keyof typeof VITAL_CONFIG];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!note.trim()) {
      setError('Please enter a note');
      return;
    }

    try {
      setIsSaving(true);
      setError('');
      await onSave(note.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save note');
      setIsSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4">
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Add Clinical Note</h3>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
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
          <div className="p-6">
            {/* Observation details */}
            <div className="bg-gray-50 rounded-lg p-4 mb-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-900">{config?.label}</span>
                <span className="text-sm text-gray-500">
                  {format(parseISO(observation.timestamp), 'MMM d, yyyy HH:mm')}
                </span>
              </div>
              <div className="text-2xl font-bold" style={{ color: config?.color }}>
                {observation.vitalType === VITAL_TYPES.BLOOD_PRESSURE
                  ? `${observation.systolic}/${observation.diastolic}`
                  : observation.value}{' '}
                <span className="text-sm font-normal text-gray-500">{config?.unit}</span>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Recorded by {observation.performerName} ({observation.performerRole})
              </p>
            </div>

            {/* Existing notes */}
            {observation.notes && observation.notes.length > 0 && (
              <div className="mb-4">
                <h4 className="text-sm font-medium text-gray-700 mb-2">Existing Notes</h4>
                <ul className="space-y-2">
                  {observation.notes.map((existingNote, i) => (
                    <li key={i} className="text-sm text-gray-600 bg-gray-50 rounded p-2">
                      {existingNote}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Note input */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Add Note
              </label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="input-field h-24 resize-none"
                placeholder="Enter your clinical note..."
                disabled={isSaving}
              />
            </div>

            {error && (
              <div className="mt-3 text-sm text-red-600">{error}</div>
            )}
          </div>

          <div className="p-6 border-t border-gray-200 flex justify-end space-x-3">
            <button type="button" onClick={onClose} className="btn-secondary" disabled={isSaving}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={isSaving || !note.trim()}>
              {isSaving ? <LoadingSpinner size="sm" /> : 'Save Note'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

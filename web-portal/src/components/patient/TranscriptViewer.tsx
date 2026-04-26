import { useState, useEffect } from 'react';
import { format, parseISO } from 'date-fns';
import { getInteractionTranscript } from '../../services/api';
import type { TranscriptEntry, InteractionSession } from '../../types';
import LoadingSpinner from '../LoadingSpinner';

interface TranscriptViewerProps {
  patientId: string;
  session: InteractionSession;
  onClose: () => void;
}

const ROLE_STYLES: Record<TranscriptEntry['role'], { align: string; bg: string; label: string }> = {
  patient: {
    align: 'justify-end',
    bg: 'bg-blue-100 text-blue-900',
    label: 'Patient',
  },
  caregiver: {
    align: 'justify-end',
    bg: 'bg-green-100 text-green-900',
    label: 'Caregiver',
  },
  system: {
    align: 'justify-start',
    bg: 'bg-gray-100 text-gray-900',
    label: 'System',
  },
};

export default function TranscriptViewer({ patientId, session, onClose }: TranscriptViewerProps) {
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadTranscript();
  }, [patientId, session.id]);

  async function loadTranscript() {
    try {
      setIsLoading(true);
      const data = await getInteractionTranscript(patientId, session.id);
      setTranscript(data);
    } catch (err) {
      console.error('Failed to load transcript:', err);
    } finally {
      setIsLoading(false);
    }
  }

  const extractedKeys = Object.keys(session.extracted_summary);

  function isExtractedValue(text: string): boolean {
    return extractedKeys.some(
      (key) =>
        session.extracted_summary[key] !== null &&
        session.extracted_summary[key] !== undefined &&
        text.toLowerCase().includes(String(session.extracted_summary[key]).toLowerCase())
    );
  }

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
      role="dialog"
      aria-modal="true"
      aria-label="Conversation transcript"
    >
      <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full mx-4 max-h-[85vh] overflow-hidden flex flex-col">
        <div className="p-6 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
          <div>
            <h3 className="text-lg font-semibold">Conversation Transcript</h3>
            <p className="text-sm text-gray-500 mt-1">
              {session.session_type.replace(/_/g, ' ')} - {session.language} -{' '}
              {format(parseISO(session.started_at), 'MMM d, yyyy HH:mm')}
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

        <div className="flex-1 overflow-y-auto p-6">
          {isLoading ? (
            <div className="flex items-center justify-center h-32">
              <LoadingSpinner size="lg" />
            </div>
          ) : transcript.length === 0 ? (
            <p className="text-gray-500 text-center">No transcript available.</p>
          ) : (
            <div className="space-y-4">
              {transcript.map((entry) => {
                const style = ROLE_STYLES[entry.role];
                const highlighted = isExtractedValue(entry.text);
                return (
                  <div key={entry.turn} className={`flex ${style.align}`}>
                    <div className={`max-w-[80%] ${highlighted ? 'ring-2 ring-yellow-400 ring-offset-1 rounded-lg' : ''}`}>
                      <div className="flex items-center space-x-2 mb-1">
                        <span className="text-xs font-medium text-gray-500">
                          #{entry.turn} {style.label}
                        </span>
                        <span className="text-xs text-gray-400">
                          {format(parseISO(entry.timestamp), 'HH:mm:ss')}
                        </span>
                      </div>
                      <div className={`rounded-lg px-4 py-2 text-sm ${style.bg}`}>
                        {entry.text}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Extracted summary */}
        {extractedKeys.length > 0 && (
          <div className="border-t border-gray-200 p-4 bg-gray-50 flex-shrink-0">
            <h4 className="text-sm font-medium text-gray-700 mb-2">Extracted Values</h4>
            <div className="flex flex-wrap gap-2">
              {extractedKeys.map((key) => (
                <span
                  key={key}
                  className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800"
                >
                  {key}: {String(session.extracted_summary[key])}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

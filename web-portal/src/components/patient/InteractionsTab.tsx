import { useState, useEffect, useCallback } from 'react';
import { format, parseISO } from 'date-fns';
import { getInteractionSessions } from '../../services/api';
import type { InteractionSession } from '../../types';
import LoadingSpinner from '../LoadingSpinner';
import TranscriptViewer from './TranscriptViewer';

interface InteractionsTabProps {
  patientId: string;
}

const SESSION_TYPE_LABELS: Record<InteractionSession['session_type'], string> = {
  patient_logging: 'Patient Logging',
  caregiver_config: 'Caregiver Config',
  caregiver_onboarding: 'Caregiver Onboarding',
};

const SESSION_TYPE_BADGE_CLASSES: Record<InteractionSession['session_type'], string> = {
  patient_logging: 'bg-blue-100 text-blue-800',
  caregiver_config: 'bg-purple-100 text-purple-800',
  caregiver_onboarding: 'bg-green-100 text-green-800',
};

const PAGE_SIZE = 20;

export default function InteractionsTab({ patientId }: InteractionsTabProps) {
  const [sessions, setSessions] = useState<InteractionSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [selectedSession, setSelectedSession] = useState<InteractionSession | null>(null);

  const loadSessions = useCallback(async (initial: boolean, currentLength = 0) => {
    try {
      if (initial) {
        setIsLoading(true);
      } else {
        setIsLoadingMore(true);
      }

      const offset = initial ? 0 : currentLength;
      const data = await getInteractionSessions(patientId, {
        limit: PAGE_SIZE,
        offset,
      });

      if (initial) {
        setSessions(data);
      } else {
        setSessions((prev) => [...prev, ...data]);
      }
      setHasMore(data.length === PAGE_SIZE);
    } catch (err) {
      console.error('Failed to load interaction sessions:', err);
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  }, [patientId]);

  useEffect(() => {
    loadSessions(true);
  }, [loadSessions]);

  function formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-gray-900">Interaction Sessions</h3>
      </div>

      {sessions.length === 0 ? (
        <div className="card text-center py-12">
          <svg
            className="mx-auto w-12 h-12 text-gray-400 mb-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
            />
          </svg>
          <p className="text-gray-600">No interaction sessions recorded yet.</p>
        </div>
      ) : (
        <>
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Date
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Type
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Language
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Turns
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Duration
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {sessions.map((session) => (
                    <tr
                      key={session.id}
                      onClick={() => setSelectedSession(session)}
                      className="hover:bg-gray-50 cursor-pointer transition-colors"
                      role="button"
                      tabIndex={0}
                      aria-label={`View transcript for ${SESSION_TYPE_LABELS[session.session_type]} session on ${format(parseISO(session.started_at), 'MMM d, yyyy')}`}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setSelectedSession(session);
                        }
                      }}
                    >
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {format(parseISO(session.started_at), 'MMM d, yyyy HH:mm')}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                            SESSION_TYPE_BADGE_CLASSES[session.session_type]
                          }`}
                        >
                          {SESSION_TYPE_LABELS[session.session_type]}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {session.language}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                            session.status === 'complete'
                              ? 'bg-green-100 text-green-800'
                              : 'bg-yellow-100 text-yellow-800'
                          }`}
                        >
                          {session.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {session.turn_count}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {formatDuration(session.duration_ms)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {hasMore && (
            <div className="mt-4 text-center">
              <button
                onClick={() => loadSessions(false, sessions.length)}
                disabled={isLoadingMore}
                className="btn-secondary"
              >
                {isLoadingMore ? <LoadingSpinner size="sm" /> : 'Load More'}
              </button>
            </div>
          )}
        </>
      )}

      {selectedSession && (
        <TranscriptViewer
          patientId={patientId}
          session={selectedSession}
          onClose={() => setSelectedSession(null)}
        />
      )}
    </div>
  );
}

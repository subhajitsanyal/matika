import { useState, useEffect } from 'react';
import { format, parseISO } from 'date-fns';
import { getRecommendations, createRecommendation } from '../../services/api';
import type { Recommendation } from '../../types';
import LoadingSpinner from '../LoadingSpinner';
import RecommendationForm from './RecommendationForm';

interface RecommendationsTabProps {
  patientId: string;
}

type StatusFilter = 'all' | 'pending' | 'accepted' | 'rejected';

const STATUS_BADGE_CLASSES: Record<Recommendation['status'], string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  accepted: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
};

const SOURCE_BADGE_CLASSES: Record<Recommendation['source'], string> = {
  analytics: 'bg-purple-100 text-purple-800',
  doctor: 'bg-blue-100 text-blue-800',
};

export default function RecommendationsTab({ patientId }: RecommendationsTabProps) {
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    loadRecommendations();
  }, [patientId]);

  async function loadRecommendations() {
    try {
      setIsLoading(true);
      const data = await getRecommendations(patientId);
      setRecommendations(data);
    } catch (err) {
      console.error('Failed to load recommendations:', err);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleCreate(data: {
    parameter_name: string;
    loinc_code?: string;
    rationale: string;
    suggested_frequency_days?: number;
  }) {
    await createRecommendation(patientId, data);
    setShowForm(false);
    await loadRecommendations();
  }

  const filtered =
    statusFilter === 'all'
      ? recommendations
      : recommendations.filter((r) => r.status === statusFilter);

  const filterOptions: { value: StatusFilter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'pending', label: 'Pending' },
    { value: 'accepted', label: 'Accepted' },
    { value: 'rejected', label: 'Rejected' },
  ];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold text-gray-900">Recommendations</h3>
        <button onClick={() => setShowForm(true)} className="btn-primary text-sm">
          New Recommendation
        </button>
      </div>

      {/* Filter bar */}
      <div className="mb-4 flex space-x-2" role="radiogroup" aria-label="Filter by status">
        {filterOptions.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setStatusFilter(opt.value)}
            role="radio"
            aria-checked={statusFilter === opt.value}
            className={`px-3 py-1.5 text-sm rounded-full transition-colors ${
              statusFilter === opt.value
                ? 'bg-carelog-primary text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
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
              d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <p className="text-gray-600">
            {statusFilter === 'all'
              ? 'No recommendations yet.'
              : `No ${statusFilter} recommendations.`}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((rec) => (
            <div
              key={rec.id}
              className={`card ${rec.status === 'pending' ? 'border-l-4 border-l-yellow-400' : ''}`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center space-x-2 mb-2">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                        SOURCE_BADGE_CLASSES[rec.source]
                      }`}
                    >
                      {rec.source}
                    </span>
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                        STATUS_BADGE_CLASSES[rec.status]
                      }`}
                    >
                      {rec.status}
                    </span>
                    <span className="text-sm font-medium text-gray-900">
                      {rec.parameter_name}
                    </span>
                  </div>
                  <p className="text-sm text-gray-700">{rec.rationale}</p>
                  {rec.suggested_frequency_days && (
                    <p className="text-xs text-gray-500 mt-1">
                      Suggested frequency: every {rec.suggested_frequency_days} day
                      {rec.suggested_frequency_days !== 1 ? 's' : ''}
                    </p>
                  )}
                  {rec.loinc_code && (
                    <p className="text-xs text-gray-500 mt-1">LOINC: {rec.loinc_code}</p>
                  )}
                </div>
                <div className="text-right text-xs text-gray-500 ml-4 flex-shrink-0">
                  <p>{format(parseISO(rec.created_at), 'MMM d, yyyy')}</p>
                  {rec.resolved_at && (
                    <p className="mt-1">
                      Resolved: {format(parseISO(rec.resolved_at), 'MMM d, yyyy')}
                    </p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <RecommendationForm
          onSubmit={handleCreate}
          onClose={() => setShowForm(false)}
        />
      )}
    </div>
  );
}

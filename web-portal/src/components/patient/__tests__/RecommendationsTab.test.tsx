import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import RecommendationsTab from '../RecommendationsTab';
import type { Recommendation } from '../../../types';

vi.mock('../../../services/api', () => ({
  getRecommendations: vi.fn(),
  createRecommendation: vi.fn(),
}));

vi.mock('../../LoadingSpinner', () => ({
  default: ({ size }: { size?: string }) => (
    <div data-testid="loading-spinner" data-size={size}>Loading...</div>
  ),
}));

vi.mock('../RecommendationForm', () => ({
  default: () => <div data-testid="recommendation-form" />,
}));

const { getRecommendations } = await import('../../../services/api');
const mockGetRecommendations = vi.mocked(getRecommendations);

const mockRecommendations: Recommendation[] = [
  {
    id: 'rec-1',
    patient_id: 'patient-1',
    source: 'analytics',
    source_doctor_id: null,
    parameter_name: 'blood_pressure',
    loinc_code: '85354-9',
    rationale: 'BP readings trending upward, recommend increasing monitoring frequency.',
    suggested_frequency_days: 1,
    status: 'pending',
    created_at: '2026-04-20T10:00:00Z',
    resolved_at: null,
  },
  {
    id: 'rec-2',
    patient_id: 'patient-1',
    source: 'doctor',
    source_doctor_id: 'doc-1',
    parameter_name: 'blood_glucose',
    loinc_code: null,
    rationale: 'Patient reports dizziness, check glucose more frequently.',
    suggested_frequency_days: 3,
    status: 'accepted',
    created_at: '2026-04-18T10:00:00Z',
    resolved_at: '2026-04-19T10:00:00Z',
  },
];

describe('RecommendationsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading spinner initially', () => {
    mockGetRecommendations.mockReturnValue(new Promise(() => {}));
    render(<RecommendationsTab patientId="patient-1" />);
    expect(screen.getByTestId('loading-spinner')).toBeInTheDocument();
  });

  it('displays recommendations after loading', async () => {
    mockGetRecommendations.mockResolvedValue(mockRecommendations);
    render(<RecommendationsTab patientId="patient-1" />);

    await waitFor(() => {
      expect(screen.getByText('blood_pressure')).toBeInTheDocument();
    });

    expect(screen.getByText('blood_glucose')).toBeInTheDocument();
    expect(screen.getByText('BP readings trending upward, recommend increasing monitoring frequency.')).toBeInTheDocument();
    expect(screen.getByText('Patient reports dizziness, check glucose more frequently.')).toBeInTheDocument();
    expect(screen.getByText('pending')).toBeInTheDocument();
    expect(screen.getByText('accepted')).toBeInTheDocument();
  });

  it('shows empty state when no recommendations exist', async () => {
    mockGetRecommendations.mockResolvedValue([]);
    render(<RecommendationsTab patientId="patient-1" />);

    await waitFor(() => {
      expect(screen.getByText('No recommendations yet.')).toBeInTheDocument();
    });
  });
});

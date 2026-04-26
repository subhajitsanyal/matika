import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import InteractionsTab from '../InteractionsTab';
import type { InteractionSession } from '../../../types';

vi.mock('../../../services/api', () => ({
  getInteractionSessions: vi.fn(),
  getInteractionTranscript: vi.fn(),
}));

vi.mock('../../LoadingSpinner', () => ({
  default: ({ size }: { size?: string }) => (
    <div data-testid="loading-spinner" data-size={size}>Loading...</div>
  ),
}));

vi.mock('../TranscriptViewer', () => ({
  default: () => <div data-testid="transcript-viewer" />,
}));

const { getInteractionSessions } = await import('../../../services/api');
const mockGetInteractionSessions = vi.mocked(getInteractionSessions);

const mockSessions: InteractionSession[] = [
  {
    id: 'sess-1',
    patient_id: 'patient-1',
    session_type: 'patient_logging',
    language: 'en',
    status: 'complete',
    turn_count: 8,
    duration_ms: 120000,
    extracted_summary: {},
    started_at: '2026-04-20T10:00:00Z',
    ended_at: '2026-04-20T10:02:00Z',
  },
  {
    id: 'sess-2',
    patient_id: 'patient-1',
    session_type: 'caregiver_config',
    language: 'hi',
    status: 'incomplete',
    turn_count: 3,
    duration_ms: 45000,
    extracted_summary: {},
    started_at: '2026-04-19T14:00:00Z',
    ended_at: '2026-04-19T14:00:45Z',
  },
];

describe('InteractionsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading spinner initially', () => {
    mockGetInteractionSessions.mockReturnValue(new Promise(() => {}));
    render(<InteractionsTab patientId="patient-1" />);
    expect(screen.getByTestId('loading-spinner')).toBeInTheDocument();
  });

  it('displays interaction sessions after loading', async () => {
    mockGetInteractionSessions.mockResolvedValue(mockSessions);
    render(<InteractionsTab patientId="patient-1" />);

    await waitFor(() => {
      expect(screen.getByText('Patient Logging')).toBeInTheDocument();
    });

    expect(screen.getByText('Caregiver Config')).toBeInTheDocument();
    expect(screen.getByText('en')).toBeInTheDocument();
    expect(screen.getByText('hi')).toBeInTheDocument();
    expect(screen.getByText('complete')).toBeInTheDocument();
    expect(screen.getByText('incomplete')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
    expect(screen.getByText('2m 0s')).toBeInTheDocument();
  });

  it('shows empty state when no sessions exist', async () => {
    mockGetInteractionSessions.mockResolvedValue([]);
    render(<InteractionsTab patientId="patient-1" />);

    await waitFor(() => {
      expect(screen.getByText('No interaction sessions recorded yet.')).toBeInTheDocument();
    });
  });
});

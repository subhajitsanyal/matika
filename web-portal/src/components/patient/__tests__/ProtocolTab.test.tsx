import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import ProtocolTab from '../ProtocolTab';
import type { ParameterConfig } from '../../../types';

vi.mock('../../../services/api', () => ({
  getParameterConfigs: vi.fn(),
  createParameterConfig: vi.fn(),
  updateParameterConfig: vi.fn(),
  deleteParameterConfig: vi.fn(),
}));

vi.mock('../../LoadingSpinner', () => ({
  default: ({ size }: { size?: string }) => (
    <div data-testid="loading-spinner" data-size={size}>Loading...</div>
  ),
}));

vi.mock('../ParameterConfigForm', () => ({
  default: () => <div data-testid="parameter-config-form" />,
}));

vi.mock('../ThresholdOverrideForm', () => ({
  default: () => <div data-testid="threshold-override-form" />,
}));

const { getParameterConfigs } = await import('../../../services/api');
const mockGetParameterConfigs = vi.mocked(getParameterConfigs);

const mockConfigs: ParameterConfig[] = [
  {
    id: 'cfg-1',
    patient_id: 'patient-1',
    parameter_name: 'blood_pressure',
    display_name: 'Blood Pressure',
    loinc_codes: ['85354-9'],
    unit: 'mmHg',
    frequency_days: 1,
    daily_deadline: '09:00',
    timezone: 'Asia/Kolkata',
    threshold_min: [90, 60],
    threshold_max: [140, 90],
    threshold_set_by: 'Dr. Smith',
    active: true,
    updated_at: '2026-04-20T10:00:00Z',
  },
  {
    id: 'cfg-2',
    patient_id: 'patient-1',
    parameter_name: 'blood_glucose',
    display_name: 'Blood Glucose',
    loinc_codes: ['15074-8'],
    unit: 'mg/dL',
    frequency_days: 7,
    daily_deadline: '08:00',
    timezone: 'Asia/Kolkata',
    threshold_min: [70],
    threshold_max: [140],
    threshold_set_by: null,
    active: true,
    updated_at: '2026-04-18T10:00:00Z',
  },
];

describe('ProtocolTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading spinner initially', () => {
    mockGetParameterConfigs.mockReturnValue(new Promise(() => {})); // never resolves
    render(<ProtocolTab patientId="patient-1" />);
    expect(screen.getByTestId('loading-spinner')).toBeInTheDocument();
  });

  it('displays parameter configs after loading', async () => {
    mockGetParameterConfigs.mockResolvedValue(mockConfigs);
    render(<ProtocolTab patientId="patient-1" />);

    await waitFor(() => {
      expect(screen.getByText('Blood Pressure')).toBeInTheDocument();
    });

    expect(screen.getByText('Blood Glucose')).toBeInTheDocument();
    expect(screen.getByText('mmHg')).toBeInTheDocument();
    expect(screen.getByText('mg/dL')).toBeInTheDocument();
    expect(screen.getByText('Every 1 day')).toBeInTheDocument();
    expect(screen.getByText('Every 7 days')).toBeInTheDocument();
  });

  it('shows empty state when no configs exist', async () => {
    mockGetParameterConfigs.mockResolvedValue([]);
    render(<ProtocolTab patientId="patient-1" />);

    await waitFor(() => {
      expect(screen.getByText('No parameters configured for this patient.')).toBeInTheDocument();
    });
  });
});

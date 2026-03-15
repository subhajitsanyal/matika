import { fetchAuthSession } from 'aws-amplify/auth';

const API_ENDPOINT = import.meta.env.VITE_API_ENDPOINT || '';

async function getAuthHeaders(): Promise<HeadersInit> {
  try {
    const session = await fetchAuthSession();
    const token = session.tokens?.accessToken?.toString();
    return {
      'Content-Type': 'application/json',
      Authorization: token ? `Bearer ${token}` : '',
    };
  } catch {
    return {
      'Content-Type': 'application/json',
    };
  }
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }));
    throw new Error(error.message || `HTTP error ${response.status}`);
  }
  return response.json();
}

// Patient API
export interface Patient {
  id: string;
  name: string;
  age: number;
  gender: string;
  lastActivity: string | null;
  unreadAlerts: number;
}

export interface PatientDetails extends Patient {
  conditions: string[];
  createdAt: string;
}

export async function getPatients(): Promise<Patient[]> {
  const headers = await getAuthHeaders();
  const response = await fetch(`${API_ENDPOINT}/doctor/patients`, { headers });
  const data = await handleResponse<{ patients: Patient[] }>(response);
  return data.patients;
}

export async function getPatientDetails(patientId: string): Promise<PatientDetails> {
  const headers = await getAuthHeaders();
  const response = await fetch(`${API_ENDPOINT}/doctor/patients/${patientId}`, { headers });
  return handleResponse<PatientDetails>(response);
}

// Observations API
export interface Observation {
  id: string;
  vitalType: string;
  value: number;
  unit: string;
  systolic?: number;
  diastolic?: number;
  timestamp: string;
  performerId: string;
  performerName: string;
  performerRole: string;
  notes?: string[];
}

export interface ObservationsResponse {
  observations: Observation[];
  total: number;
}

export async function getObservations(
  patientId: string,
  options: {
    vitalType?: string;
    startDate?: string;
    endDate?: string;
    limit?: number;
    offset?: number;
  } = {}
): Promise<ObservationsResponse> {
  const headers = await getAuthHeaders();
  const params = new URLSearchParams();

  if (options.vitalType) params.set('vitalType', options.vitalType);
  if (options.startDate) params.set('startDate', options.startDate);
  if (options.endDate) params.set('endDate', options.endDate);
  if (options.limit) params.set('limit', options.limit.toString());
  if (options.offset) params.set('offset', options.offset.toString());

  const url = `${API_ENDPOINT}/doctor/patients/${patientId}/observations?${params}`;
  const response = await fetch(url, { headers });
  return handleResponse<ObservationsResponse>(response);
}

// Add annotation to observation
export async function addObservationNote(
  patientId: string,
  observationId: string,
  note: string
): Promise<void> {
  const headers = await getAuthHeaders();
  const response = await fetch(
    `${API_ENDPOINT}/doctor/patients/${patientId}/observations/${observationId}/notes`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ note }),
    }
  );
  await handleResponse<{ success: boolean }>(response);
}

// Documents API
export interface DocumentReference {
  id: string;
  fileType: string;
  fileName: string;
  contentType: string;
  uploadedAt: string;
  uploadedBy: string;
  s3Key: string;
}

export async function getDocuments(
  patientId: string,
  fileType?: string
): Promise<DocumentReference[]> {
  const headers = await getAuthHeaders();
  const params = fileType ? `?fileType=${fileType}` : '';
  const response = await fetch(
    `${API_ENDPOINT}/doctor/patients/${patientId}/documents${params}`,
    { headers }
  );
  const data = await handleResponse<{ documents: DocumentReference[] }>(response);
  return data.documents;
}

export async function getDocumentDownloadUrl(
  patientId: string,
  documentId: string
): Promise<string> {
  const headers = await getAuthHeaders();
  const response = await fetch(
    `${API_ENDPOINT}/doctor/patients/${patientId}/documents/${documentId}/download`,
    { headers }
  );
  const data = await handleResponse<{ url: string }>(response);
  return data.url;
}

// Care Plan API
export interface CarePlan {
  id: string;
  content: string;
  updatedAt: string;
  updatedBy: string;
  version: number;
}

export interface CarePlanHistory {
  versions: CarePlan[];
}

export async function getCarePlan(patientId: string): Promise<CarePlan | null> {
  const headers = await getAuthHeaders();
  const response = await fetch(`${API_ENDPOINT}/doctor/patients/${patientId}/care-plan`, {
    headers,
  });

  if (response.status === 404) {
    return null;
  }

  return handleResponse<CarePlan>(response);
}

export async function saveCarePlan(patientId: string, content: string): Promise<CarePlan> {
  const headers = await getAuthHeaders();
  const response = await fetch(`${API_ENDPOINT}/doctor/patients/${patientId}/care-plan`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ content }),
  });
  return handleResponse<CarePlan>(response);
}

export async function getCarePlanHistory(patientId: string): Promise<CarePlanHistory> {
  const headers = await getAuthHeaders();
  const response = await fetch(
    `${API_ENDPOINT}/doctor/patients/${patientId}/care-plan/history`,
    { headers }
  );
  return handleResponse<CarePlanHistory>(response);
}

// Thresholds API
export interface Threshold {
  vitalType: string;
  minValue: number | null;
  maxValue: number | null;
  setBy: 'doctor' | 'relative';
  setByName: string;
  updatedAt: string;
}

export async function getThresholds(patientId: string): Promise<Threshold[]> {
  const headers = await getAuthHeaders();
  const response = await fetch(`${API_ENDPOINT}/doctor/patients/${patientId}/thresholds`, {
    headers,
  });
  const data = await handleResponse<{ thresholds: Threshold[] }>(response);
  return data.thresholds;
}

export async function setThreshold(
  patientId: string,
  vitalType: string,
  minValue: number | null,
  maxValue: number | null
): Promise<Threshold> {
  const headers = await getAuthHeaders();
  const response = await fetch(
    `${API_ENDPOINT}/doctor/patients/${patientId}/thresholds/${vitalType}`,
    {
      method: 'PUT',
      headers,
      body: JSON.stringify({ minValue, maxValue }),
    }
  );
  return handleResponse<Threshold>(response);
}

// Doctor Registration API
export async function validateInviteToken(token: string): Promise<{ valid: boolean; email?: string; patientName?: string }> {
  const response = await fetch(`${API_ENDPOINT}/invites/validate?token=${token}`);
  return handleResponse<{ valid: boolean; email?: string; patientName?: string }>(response);
}

export async function completeRegistration(
  token: string,
  password: string
): Promise<{ success: boolean }> {
  const response = await fetch(`${API_ENDPOINT}/invites/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, password }),
  });
  return handleResponse<{ success: boolean }>(response);
}

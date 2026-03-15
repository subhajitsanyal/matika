import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getPatientDetails, PatientDetails } from '../services/api';
import LoadingSpinner from '../components/LoadingSpinner';
import VitalsTab from '../components/patient/VitalsTab';
import FilesTab from '../components/patient/FilesTab';
import CarePlanTab from '../components/patient/CarePlanTab';
import ThresholdsTab from '../components/patient/ThresholdsTab';

type TabType = 'vitals' | 'files' | 'careplan' | 'thresholds';

export default function PatientViewPage() {
  const { patientId } = useParams<{ patientId: string }>();
  const [patient, setPatient] = useState<PatientDetails | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<TabType>('vitals');

  useEffect(() => {
    if (patientId) {
      loadPatient(patientId);
    }
  }, [patientId]);

  async function loadPatient(id: string) {
    try {
      setIsLoading(true);
      const data = await getPatientDetails(id);
      setPatient(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load patient');
    } finally {
      setIsLoading(false);
    }
  }

  const tabs: { id: TabType; label: string; icon: JSX.Element }[] = [
    {
      id: 'vitals',
      label: 'Vitals Timeline',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
      ),
    },
    {
      id: 'files',
      label: 'Files',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      ),
    },
    {
      id: 'careplan',
      label: 'Care Plan',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
        </svg>
      ),
    },
    {
      id: 'thresholds',
      label: 'Thresholds',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
        </svg>
      ),
    },
  ];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (error || !patient) {
    return (
      <div className="card text-center py-8">
        <p className="text-red-600 mb-4">{error || 'Patient not found'}</p>
        <Link to="/patients" className="btn-primary">
          Back to Patients
        </Link>
      </div>
    );
  }

  return (
    <div>
      {/* Breadcrumb */}
      <nav className="mb-4">
        <Link to="/patients" className="text-carelog-primary hover:underline text-sm">
          &larr; Back to Patients
        </Link>
      </nav>

      {/* Patient header */}
      <div className="card mb-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{patient.name}</h1>
            <div className="mt-1 text-sm text-gray-500">
              <span>ID: {patient.id}</span>
              <span className="mx-2">|</span>
              <span>{patient.age} years old, {patient.gender}</span>
            </div>
            {patient.conditions.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {patient.conditions.map((condition, index) => (
                  <span
                    key={index}
                    className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800"
                  >
                    {condition}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="-mb-px flex space-x-8">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center space-x-2 py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === tab.id
                  ? 'border-carelog-primary text-carelog-primary'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          ))}
        </nav>
      </div>

      {/* Tab content */}
      <div>
        {activeTab === 'vitals' && <VitalsTab patientId={patient.id} />}
        {activeTab === 'files' && <FilesTab patientId={patient.id} />}
        {activeTab === 'careplan' && <CarePlanTab patientId={patient.id} />}
        {activeTab === 'thresholds' && <ThresholdsTab patientId={patient.id} />}
      </div>
    </div>
  );
}

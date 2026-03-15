import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { getPatients, Patient } from '../services/api';
import LoadingSpinner from '../components/LoadingSpinner';
import { formatDistanceToNow } from 'date-fns';

export default function PatientListPage() {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<keyof Patient>('name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  useEffect(() => {
    loadPatients();
  }, []);

  async function loadPatients() {
    try {
      setIsLoading(true);
      const data = await getPatients();
      setPatients(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load patients');
    } finally {
      setIsLoading(false);
    }
  }

  const filteredPatients = useMemo(() => {
    let result = patients;

    // Filter by search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(query) ||
          p.id.toLowerCase().includes(query)
      );
    }

    // Sort
    result = [...result].sort((a, b) => {
      let aVal = a[sortField];
      let bVal = b[sortField];

      if (aVal === null) aVal = '';
      if (bVal === null) bVal = '';

      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortDirection === 'asc'
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      }

      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
      }

      return 0;
    });

    return result;
  }, [patients, searchQuery, sortField, sortDirection]);

  function handleSort(field: keyof Patient) {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  }

  function SortIcon({ field }: { field: keyof Patient }) {
    if (sortField !== field) {
      return (
        <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
        </svg>
      );
    }

    return sortDirection === 'asc' ? (
      <svg className="w-4 h-4 text-carelog-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
      </svg>
    ) : (
      <svg className="w-4 h-4 text-carelog-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
      </svg>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="card text-center py-8">
        <p className="text-red-600 mb-4">{error}</p>
        <button onClick={loadPatients} className="btn-primary">
          Try Again
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">My Patients</h1>
        <div className="text-sm text-gray-500">{patients.length} patients</div>
      </div>

      {/* Search */}
      <div className="mb-6">
        <div className="relative">
          <svg
            className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            type="text"
            placeholder="Search by name or ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="input-field pl-10"
          />
        </div>
      </div>

      {/* Patient table */}
      {filteredPatients.length === 0 ? (
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
              d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
            />
          </svg>
          <p className="text-gray-600">
            {searchQuery ? 'No patients match your search' : 'No patients assigned yet'}
          </p>
        </div>
      ) : (
        <div className="card overflow-hidden p-0">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort('name')}
                >
                  <div className="flex items-center space-x-1">
                    <span>Patient</span>
                    <SortIcon field="name" />
                  </div>
                </th>
                <th
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort('age')}
                >
                  <div className="flex items-center space-x-1">
                    <span>Age</span>
                    <SortIcon field="age" />
                  </div>
                </th>
                <th
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort('lastActivity')}
                >
                  <div className="flex items-center space-x-1">
                    <span>Last Activity</span>
                    <SortIcon field="lastActivity" />
                  </div>
                </th>
                <th
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort('unreadAlerts')}
                >
                  <div className="flex items-center space-x-1">
                    <span>Alerts</span>
                    <SortIcon field="unreadAlerts" />
                  </div>
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredPatients.map((patient) => (
                <tr key={patient.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div>
                      <div className="text-sm font-medium text-gray-900">{patient.name}</div>
                      <div className="text-xs text-gray-500">{patient.id}</div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-900">
                      {patient.age} yrs, {patient.gender}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-500">
                      {patient.lastActivity
                        ? formatDistanceToNow(new Date(patient.lastActivity), { addSuffix: true })
                        : 'No activity'}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {patient.unreadAlerts > 0 ? (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                        {patient.unreadAlerts} unread
                      </span>
                    ) : (
                      <span className="text-sm text-gray-500">None</span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right">
                    <Link
                      to={`/patients/${patient.id}`}
                      className="text-carelog-primary hover:text-primary-700 font-medium text-sm"
                    >
                      View Details
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

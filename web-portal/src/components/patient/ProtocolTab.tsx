import { useState, useEffect, useCallback } from 'react';
import {
  getParameterConfigs,
  createParameterConfig,
  updateParameterConfig,
  deleteParameterConfig,
} from '../../services/api';
import type { ParameterConfig } from '../../types';
import LoadingSpinner from '../LoadingSpinner';
import ParameterConfigForm from './ParameterConfigForm';
import ThresholdOverrideForm from './ThresholdOverrideForm';

interface ProtocolTabProps {
  patientId: string;
}

export default function ProtocolTab({ patientId }: ProtocolTabProps) {
  const [configs, setConfigs] = useState<ParameterConfig[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingConfig, setEditingConfig] = useState<ParameterConfig | null>(null);
  const [thresholdConfig, setThresholdConfig] = useState<ParameterConfig | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const loadConfigs = useCallback(async () => {
    try {
      setIsLoading(true);
      const data = await getParameterConfigs(patientId);
      setConfigs(data);
    } catch (err) {
      console.error('Failed to load parameter configs:', err);
    } finally {
      setIsLoading(false);
    }
  }, [patientId]);

  useEffect(() => {
    loadConfigs();
  }, [loadConfigs]);

  async function handleCreate(data: Partial<ParameterConfig>) {
    await createParameterConfig(patientId, data);
    setShowForm(false);
    await loadConfigs();
  }

  async function handleUpdate(data: Partial<ParameterConfig>) {
    if (!editingConfig) return;
    await updateParameterConfig(patientId, editingConfig.id, data);
    setEditingConfig(null);
    await loadConfigs();
  }

  async function handleDelete(configId: string) {
    try {
      await deleteParameterConfig(patientId, configId);
      setDeleteConfirmId(null);
      await loadConfigs();
    } catch (err) {
      console.error('Failed to delete parameter config:', err);
    }
  }

  async function handleThresholdSave(data: {
    threshold_min: number[] | null;
    threshold_max: number[] | null;
  }) {
    if (!thresholdConfig) return;
    await updateParameterConfig(patientId, thresholdConfig.id, data);
    setThresholdConfig(null);
    await loadConfigs();
  }

  function formatThreshold(values: number[] | null): string {
    if (!values || values.length === 0) return '-';
    return values.join(', ');
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
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold text-gray-900">Protocol Parameters</h3>
        <button onClick={() => setShowForm(true)} className="btn-primary text-sm">
          Add Parameter
        </button>
      </div>

      {configs.length === 0 ? (
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
              d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"
            />
          </svg>
          <p className="text-gray-600 mb-4">No parameters configured for this patient.</p>
          <button onClick={() => setShowForm(true)} className="btn-primary">
            Add First Parameter
          </button>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Parameter
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Unit
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Frequency
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Deadline
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Threshold Range
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Set By
                  </th>
                  <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {configs.map((config) => (
                  <tr key={config.id}>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">
                        {config.display_name}
                      </div>
                      <div className="text-xs text-gray-500">{config.parameter_name}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {config.unit}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      Every {config.frequency_days} day{config.frequency_days !== 1 ? 's' : ''}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {config.daily_deadline}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      <span title="Min">{formatThreshold(config.threshold_min)}</span>
                      {' / '}
                      <span title="Max">{formatThreshold(config.threshold_max)}</span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {config.threshold_set_by || '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm space-x-2">
                      <button
                        onClick={() => setThresholdConfig(config)}
                        className="text-green-600 hover:text-green-800"
                        title="Set thresholds"
                      >
                        Thresholds
                      </button>
                      <button
                        onClick={() => setEditingConfig(config)}
                        className="text-carelog-primary hover:underline"
                      >
                        Edit
                      </button>
                      {deleteConfirmId === config.id ? (
                        <span className="inline-flex items-center space-x-1">
                          <button
                            onClick={() => handleDelete(config.id)}
                            className="text-red-600 hover:text-red-800 font-medium"
                          >
                            Confirm
                          </button>
                          <button
                            onClick={() => setDeleteConfirmId(null)}
                            className="text-gray-500 hover:text-gray-700"
                          >
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <button
                          onClick={() => setDeleteConfirmId(config.id)}
                          className="text-red-600 hover:text-red-800"
                        >
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showForm && (
        <ParameterConfigForm onSubmit={handleCreate} onClose={() => setShowForm(false)} />
      )}

      {editingConfig && (
        <ParameterConfigForm
          existingConfig={editingConfig}
          onSubmit={handleUpdate}
          onClose={() => setEditingConfig(null)}
        />
      )}

      {thresholdConfig && (
        <ThresholdOverrideForm
          config={thresholdConfig}
          onSubmit={handleThresholdSave}
          onClose={() => setThresholdConfig(null)}
        />
      )}
    </div>
  );
}

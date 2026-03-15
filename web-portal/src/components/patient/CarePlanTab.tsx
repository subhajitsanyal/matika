import { useState, useEffect } from 'react';
import { format, parseISO } from 'date-fns';
import ReactQuill from 'react-quill';
import 'react-quill/dist/quill.snow.css';
import { getCarePlan, saveCarePlan, getCarePlanHistory, CarePlan } from '../../services/api';
import LoadingSpinner from '../LoadingSpinner';

interface CarePlanTabProps {
  patientId: string;
}

export default function CarePlanTab({ patientId }: CarePlanTabProps) {
  const [carePlan, setCarePlan] = useState<CarePlan | null>(null);
  const [content, setContent] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<CarePlan[]>([]);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    loadCarePlan();
  }, [patientId]);

  useEffect(() => {
    if (carePlan) {
      setHasChanges(content !== carePlan.content);
    } else {
      setHasChanges(content.length > 0);
    }
  }, [content, carePlan]);

  async function loadCarePlan() {
    try {
      setIsLoading(true);
      const data = await getCarePlan(patientId);
      setCarePlan(data);
      setContent(data?.content || '');
    } catch (error) {
      console.error('Failed to load care plan:', error);
    } finally {
      setIsLoading(false);
    }
  }

  async function loadHistory() {
    try {
      const data = await getCarePlanHistory(patientId);
      setHistory(data.versions);
      setShowHistory(true);
    } catch (error) {
      console.error('Failed to load history:', error);
    }
  }

  async function handleSave() {
    try {
      setIsSaving(true);
      const saved = await saveCarePlan(patientId, content);
      setCarePlan(saved);
      setIsEditing(false);
      setHasChanges(false);
    } catch (error) {
      console.error('Failed to save care plan:', error);
    } finally {
      setIsSaving(false);
    }
  }

  function handleCancel() {
    setContent(carePlan?.content || '');
    setIsEditing(false);
    setHasChanges(false);
  }

  const modules = {
    toolbar: [
      [{ header: [1, 2, 3, false] }],
      ['bold', 'italic', 'underline', 'strike'],
      [{ list: 'ordered' }, { list: 'bullet' }],
      ['link'],
      ['clean'],
    ],
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div>
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Care Plan</h3>
            {carePlan && (
              <p className="text-sm text-gray-500">
                Last updated {format(parseISO(carePlan.updatedAt), 'MMM d, yyyy HH:mm')} by{' '}
                {carePlan.updatedBy}
              </p>
            )}
          </div>
          <div className="flex items-center space-x-2">
            {carePlan && (
              <button onClick={loadHistory} className="btn-secondary text-sm">
                View History
              </button>
            )}
            {!isEditing ? (
              <button onClick={() => setIsEditing(true)} className="btn-primary text-sm">
                {carePlan ? 'Edit' : 'Create Care Plan'}
              </button>
            ) : (
              <>
                <button onClick={handleCancel} className="btn-secondary text-sm">
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={isSaving || !hasChanges}
                  className="btn-primary text-sm"
                >
                  {isSaving ? <LoadingSpinner size="sm" /> : 'Save Changes'}
                </button>
              </>
            )}
          </div>
        </div>

        {isEditing ? (
          <div className="prose-editor">
            <ReactQuill
              theme="snow"
              value={content}
              onChange={setContent}
              modules={modules}
              placeholder="Enter care plan details..."
              className="bg-white"
            />
            <style>{`
              .prose-editor .ql-container {
                min-height: 300px;
                font-size: 14px;
              }
              .prose-editor .ql-editor {
                min-height: 300px;
              }
            `}</style>
          </div>
        ) : carePlan ? (
          <div
            className="prose prose-sm max-w-none"
            dangerouslySetInnerHTML={{ __html: carePlan.content }}
          />
        ) : (
          <div className="text-center py-12">
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
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"
              />
            </svg>
            <p className="text-gray-600">No care plan has been created yet.</p>
            <button onClick={() => setIsEditing(true)} className="btn-primary mt-4">
              Create Care Plan
            </button>
          </div>
        )}
      </div>

      {/* History modal */}
      {showHistory && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] overflow-hidden">
            <div className="p-6 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold">Care Plan History</h3>
              <button
                onClick={() => setShowHistory(false)}
                className="text-gray-400 hover:text-gray-600"
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
            <div className="p-6 overflow-y-auto max-h-[60vh]">
              {history.length === 0 ? (
                <p className="text-gray-500 text-center">No history available.</p>
              ) : (
                <div className="space-y-4">
                  {history.map((version, index) => (
                    <div key={version.id} className="border border-gray-200 rounded-lg p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-gray-900">
                          Version {history.length - index}
                        </span>
                        <span className="text-xs text-gray-500">
                          {format(parseISO(version.updatedAt), 'MMM d, yyyy HH:mm')} by{' '}
                          {version.updatedBy}
                        </span>
                      </div>
                      <div
                        className="prose prose-sm max-w-none text-gray-600"
                        dangerouslySetInnerHTML={{ __html: version.content }}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

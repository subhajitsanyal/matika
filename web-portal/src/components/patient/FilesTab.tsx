import { useState, useEffect } from 'react';
import { format, parseISO } from 'date-fns';
import { getDocuments, getDocumentDownloadUrl, DocumentReference } from '../../services/api';
import { FILE_TYPES, FILE_TYPE_LABELS } from '../../config/constants';
import LoadingSpinner from '../LoadingSpinner';

interface FilesTabProps {
  patientId: string;
}

export default function FilesTab({ patientId }: FilesTabProps) {
  const [documents, setDocuments] = useState<DocumentReference[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedType, setSelectedType] = useState<string>('all');
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  useEffect(() => {
    loadDocuments();
  }, [patientId, selectedType]);

  async function loadDocuments() {
    try {
      setIsLoading(true);
      const fileType = selectedType === 'all' ? undefined : selectedType;
      const data = await getDocuments(patientId, fileType);
      setDocuments(data);
    } catch (error) {
      console.error('Failed to load documents:', error);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleDownload(doc: DocumentReference) {
    try {
      setDownloadingId(doc.id);
      const url = await getDocumentDownloadUrl(patientId, doc.id);
      window.open(url, '_blank');
    } catch (error) {
      console.error('Failed to get download URL:', error);
    } finally {
      setDownloadingId(null);
    }
  }

  function getFileIcon(fileType: string, contentType: string) {
    if (contentType.startsWith('image/')) {
      return (
        <svg className="w-10 h-10 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      );
    }

    if (contentType.startsWith('audio/')) {
      return (
        <svg className="w-10 h-10 text-purple-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
        </svg>
      );
    }

    if (contentType.startsWith('video/')) {
      return (
        <svg className="w-10 h-10 text-pink-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
      );
    }

    if (contentType === 'application/pdf') {
      return (
        <svg className="w-10 h-10 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
        </svg>
      );
    }

    return (
      <svg className="w-10 h-10 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    );
  }

  function getFileTypeBadgeColor(fileType: string) {
    switch (fileType) {
      case FILE_TYPES.PRESCRIPTION:
        return 'bg-blue-100 text-blue-800';
      case FILE_TYPES.WOUND_PHOTO:
        return 'bg-red-100 text-red-800';
      case FILE_TYPES.LAB_REPORT:
        return 'bg-green-100 text-green-800';
      case FILE_TYPES.VOICE_NOTE:
        return 'bg-purple-100 text-purple-800';
      case FILE_TYPES.VIDEO_NOTE:
        return 'bg-pink-100 text-pink-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  }

  const fileTypes = [
    { value: 'all', label: 'All Files' },
    ...Object.entries(FILE_TYPE_LABELS).map(([value, label]) => ({ value, label })),
  ];

  return (
    <div>
      {/* Filter */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 mb-1">File Type</label>
        <select
          value={selectedType}
          onChange={(e) => setSelectedType(e.target.value)}
          className="input-field max-w-xs"
        >
          {fileTypes.map((ft) => (
            <option key={ft.value} value={ft.value}>
              {ft.label}
            </option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <LoadingSpinner size="lg" />
        </div>
      ) : documents.length === 0 ? (
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
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
          <p className="text-gray-600">No files found.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {documents.map((doc) => (
            <div key={doc.id} className="card flex items-start space-x-4">
              <div className="flex-shrink-0">{getFileIcon(doc.fileType, doc.contentType)}</div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{doc.fileName}</p>
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium mt-1 ${getFileTypeBadgeColor(doc.fileType)}`}
                >
                  {FILE_TYPE_LABELS[doc.fileType as keyof typeof FILE_TYPE_LABELS] || doc.fileType}
                </span>
                <p className="text-xs text-gray-500 mt-2">
                  Uploaded {format(parseISO(doc.uploadedAt), 'MMM d, yyyy HH:mm')}
                </p>
                <p className="text-xs text-gray-400">By {doc.uploadedBy}</p>
                <button
                  onClick={() => handleDownload(doc)}
                  disabled={downloadingId === doc.id}
                  className="mt-3 text-sm text-carelog-primary hover:underline flex items-center space-x-1"
                >
                  {downloadingId === doc.id ? (
                    <>
                      <LoadingSpinner size="sm" />
                      <span>Loading...</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                        />
                      </svg>
                      <span>Download</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import PatientListPage from './pages/PatientListPage';
import PatientViewPage from './pages/PatientViewPage';
import DoctorRegistrationPage from './pages/DoctorRegistrationPage';
import NotFoundPage from './pages/NotFoundPage';
import LoadingSpinner from './components/LoadingSpinner';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading, isDoctor } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!isDoctor) {
    return <Navigate to="/unauthorized" replace />;
  }

  return <>{children}</>;
}

function App() {
  return (
    <Routes>
      {/* Public routes */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<DoctorRegistrationPage />} />
      <Route
        path="/unauthorized"
        element={
          <div className="min-h-screen flex items-center justify-center">
            <div className="text-center">
              <h1 className="text-2xl font-bold text-gray-900 mb-2">Access Denied</h1>
              <p className="text-gray-600">
                This portal is only accessible to doctors.
              </p>
            </div>
          </div>
        }
      />

      {/* Protected routes */}
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/patients" replace />} />
        <Route path="patients" element={<PatientListPage />} />
        <Route path="patients/:patientId" element={<PatientViewPage />} />
      </Route>

      {/* 404 */}
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

export default App;

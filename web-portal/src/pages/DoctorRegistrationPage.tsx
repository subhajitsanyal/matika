import { useState, useEffect, FormEvent } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { validateInviteToken, completeRegistration } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import LoadingSpinner from '../components/LoadingSpinner';

type Step = 'validating' | 'register' | 'confirm' | 'success' | 'error';

export default function DoctorRegistrationPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { register, confirmRegistration, login } = useAuth();

  const [step, setStep] = useState<Step>('validating');
  const [email, setEmail] = useState('');
  const [patientName, setPatientName] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [confirmationCode, setConfirmationCode] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const token = searchParams.get('token');

  useEffect(() => {
    if (token) {
      validateToken(token);
    } else {
      setStep('error');
      setError('Invalid invite link. Please check the link and try again.');
    }
  }, [token]);

  async function validateToken(inviteToken: string) {
    try {
      const result = await validateInviteToken(inviteToken);
      if (result.valid && result.email) {
        setEmail(result.email);
        setPatientName(result.patientName || 'the patient');
        setStep('register');
      } else {
        setStep('error');
        setError('This invite link is invalid or has expired.');
      }
    } catch {
      setStep('error');
      setError('Failed to validate invite. Please try again later.');
    }
  }

  async function handleRegister(e: FormEvent) {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    try {
      setIsLoading(true);
      await register(email, password, name);
      setStep('confirm');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setIsLoading(false);
    }
  }

  async function handleConfirm(e: FormEvent) {
    e.preventDefault();
    setError('');

    try {
      setIsLoading(true);
      await confirmRegistration(email, confirmationCode);

      // Complete registration with backend (link to patient)
      if (token) {
        await completeRegistration(token, password);
      }

      // Auto-login
      await login(email, password);
      setStep('success');

      // Redirect after a moment
      setTimeout(() => {
        navigate('/patients');
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Confirmation failed');
    } finally {
      setIsLoading(false);
    }
  }

  if (step === 'validating') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <LoadingSpinner size="lg" />
          <p className="mt-4 text-gray-600">Validating your invite...</p>
        </div>
      </div>
    );
  }

  if (step === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4">
        <div className="max-w-md w-full card text-center">
          <div className="mx-auto w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-4">
            <svg className="w-8 h-8 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Invalid Invite</h2>
          <p className="text-gray-600 mb-6">{error}</p>
          <Link to="/login" className="btn-primary">
            Go to Login
          </Link>
        </div>
      </div>
    );
  }

  if (step === 'success') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4">
        <div className="max-w-md w-full card text-center">
          <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
            <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Welcome to CareLog!</h2>
          <p className="text-gray-600 mb-4">
            Your account has been created and linked to {patientName}.
          </p>
          <p className="text-sm text-gray-500">Redirecting to dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="mx-auto w-16 h-16 bg-carelog-primary rounded-2xl flex items-center justify-center mb-4">
            <svg
              className="w-10 h-10 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
              />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-gray-900">CareLog</h1>
          <p className="text-gray-600 mt-2">Doctor Registration</p>
        </div>

        <div className="card">
          {step === 'register' && (
            <>
              <div className="mb-6">
                <h2 className="text-xl font-semibold text-gray-900">Create Your Account</h2>
                <p className="text-sm text-gray-600 mt-1">
                  You've been invited to join {patientName}'s care team.
                </p>
              </div>

              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                  {error}
                </div>
              )}

              <form onSubmit={handleRegister} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                  <input
                    type="email"
                    value={email}
                    className="input-field bg-gray-50"
                    disabled
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="input-field"
                    placeholder="Dr. John Smith"
                    required
                    disabled={isLoading}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="input-field"
                    placeholder="At least 8 characters"
                    required
                    disabled={isLoading}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Confirm Password
                  </label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="input-field"
                    placeholder="Re-enter password"
                    required
                    disabled={isLoading}
                  />
                </div>

                <button type="submit" className="btn-primary w-full" disabled={isLoading}>
                  {isLoading ? <LoadingSpinner size="sm" /> : 'Create Account'}
                </button>
              </form>
            </>
          )}

          {step === 'confirm' && (
            <>
              <div className="mb-6">
                <h2 className="text-xl font-semibold text-gray-900">Verify Your Email</h2>
                <p className="text-sm text-gray-600 mt-1">
                  We've sent a verification code to {email}
                </p>
              </div>

              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                  {error}
                </div>
              )}

              <form onSubmit={handleConfirm} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Verification Code
                  </label>
                  <input
                    type="text"
                    value={confirmationCode}
                    onChange={(e) => setConfirmationCode(e.target.value)}
                    className="input-field text-center text-2xl tracking-widest"
                    placeholder="000000"
                    maxLength={6}
                    required
                    disabled={isLoading}
                  />
                </div>

                <button type="submit" className="btn-primary w-full" disabled={isLoading}>
                  {isLoading ? <LoadingSpinner size="sm" /> : 'Verify & Complete'}
                </button>
              </form>
            </>
          )}

          <div className="mt-6 text-center text-sm text-gray-600">
            Already have an account?{' '}
            <Link to="/login" className="text-carelog-primary font-medium hover:underline">
              Sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

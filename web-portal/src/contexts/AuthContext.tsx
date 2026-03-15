import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import {
  signIn,
  signOut,
  getCurrentUser,
  fetchAuthSession,
  signUp,
  confirmSignUp,
} from 'aws-amplify/auth';

interface User {
  id: string;
  email: string;
  name?: string;
  groups: string[];
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isDoctor: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
  confirmRegistration: (email: string, code: string) => Promise<void>;
  getAccessToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    checkAuthState();
  }, []);

  async function checkAuthState() {
    try {
      const currentUser = await getCurrentUser();
      const session = await fetchAuthSession();

      const idToken = session.tokens?.idToken;
      const groups = (idToken?.payload['cognito:groups'] as string[]) || [];

      setUser({
        id: currentUser.userId,
        email: currentUser.signInDetails?.loginId || '',
        name: idToken?.payload['name'] as string,
        groups,
      });
    } catch {
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }

  async function login(email: string, password: string) {
    const result = await signIn({ username: email, password });

    if (result.isSignedIn) {
      await checkAuthState();
    }
  }

  async function logout() {
    await signOut();
    setUser(null);
  }

  async function register(email: string, password: string, name: string) {
    await signUp({
      username: email,
      password,
      options: {
        userAttributes: {
          email,
          name,
        },
      },
    });
  }

  async function confirmRegistration(email: string, code: string) {
    await confirmSignUp({
      username: email,
      confirmationCode: code,
    });
  }

  async function getAccessToken(): Promise<string | null> {
    try {
      const session = await fetchAuthSession();
      return session.tokens?.accessToken?.toString() || null;
    } catch {
      return null;
    }
  }

  const isDoctor = user?.groups.includes('doctors') || false;

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isDoctor,
        login,
        logout,
        register,
        confirmRegistration,
        getAccessToken,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

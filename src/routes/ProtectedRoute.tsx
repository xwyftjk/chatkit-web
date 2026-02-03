import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../stores/auth.js';

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const location = useLocation();
  const access_token = useAuthStore((s) => s.access_token);

  if (!access_token) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return <>{children}</>;
}

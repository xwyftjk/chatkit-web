import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout.js';
import { ProtectedRoute } from './routes/ProtectedRoute.js';
import { Login } from './pages/Login.js';
import { Register } from './pages/Register.js';
import { Workspace } from './pages/Workspace.js';
import { Me } from './pages/Me.js';
import { Doc } from './pages/Doc.js';
import { useAuthStore } from './stores/auth.js';

export default function App() {
  const loadFromStorage = useAuthStore((s) => s.loadFromStorage);

  useEffect(() => {
    loadFromStorage();
  }, [loadFromStorage]);

  useEffect(() => {
    const onLogout = () => {
      window.location.href = '/login';
    };
    window.addEventListener('auth:logout', onLogout);
    return () => window.removeEventListener('auth:logout', onLogout);
  }, []);

  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Workspace />} />
          <Route path="me" element={<Me />} />
          <Route path="doc" element={<Doc />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

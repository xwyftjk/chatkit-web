import { useState, useEffect } from 'react';
import { Link, Outlet, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/auth.js';

const MEMORY_DASHBOARD_PORT = 26550;
const TEMPORAL_UI_PORT = 8233;

export function Layout() {
  const navigate = useNavigate();
  const user_id = useAuthStore((s) => s.user_id);
  const logout = useAuthStore((s) => s.logout);
  const [memoryDashboardUrl, setMemoryDashboardUrl] = useState('');
  const [temporalUiUrl, setTemporalUiUrl] = useState('');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setMemoryDashboardUrl(`${window.location.protocol}//${window.location.hostname}:${MEMORY_DASHBOARD_PORT}`);
      setTemporalUiUrl(`${window.location.protocol}//${window.location.hostname}:${TEMPORAL_UI_PORT}`);
    }
  }, []);

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="min-h-screen flex flex-col bg-[rgb(var(--surface))]">
      <header className="bg-[rgb(var(--header-bg))] border-b border-[rgb(var(--header-border))] flex items-center justify-between px-4 py-2.5 shadow-sm">
        <div className="flex items-center gap-4">
          <Link to="/" className="flex items-center gap-2 font-semibold text-lg text-white tracking-tight">
            <span className="w-7 h-7 rounded-lg bg-cyan-500/20 flex items-center justify-center text-cyan-400 text-sm" aria-hidden>◇</span>
            ChatKit 工作台
          </Link>
          <Link to="/doc" className="text-slate-300 hover:text-white text-sm transition-colors">开发文档</Link>
          {memoryDashboardUrl && (
            <a
              href={memoryDashboardUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-slate-300 hover:text-white text-sm transition-colors"
            >
              Memory Dashboard
            </a>
          )}
          {temporalUiUrl && (
            <a
              href={temporalUiUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-slate-300 hover:text-white text-sm transition-colors"
              title="工作流与定时任务：请点左侧 Schedules 查看预置定时任务，Workflows 查看执行记录"
            >
              Temporal 工作流 (Schedules)
            </a>
          )}
        </div>
        <div className="flex items-center gap-3">
          <Link to="/me" className="text-slate-300 hover:text-white text-sm transition-colors">我的</Link>
          {user_id && (
            <button
              type="button"
              onClick={handleLogout}
              className="text-slate-300 hover:text-white text-sm transition-colors ring-accent rounded px-2 py-1"
            >
              退出登录
            </button>
          )}
        </div>
      </header>
      <main className="flex-1 overflow-auto relative">
        <Outlet />
      </main>
    </div>
  );
}

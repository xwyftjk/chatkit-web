import { Link, Outlet, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/auth.js';

export function Layout() {
  const navigate = useNavigate();
  const user_id = useAuthStore((s) => s.user_id);
  const logout = useAuthStore((s) => s.logout);

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="min-h-screen flex flex-col bg-[rgb(var(--surface))]">
      <header className="bg-[rgb(var(--header-bg))] border-b border-[rgb(var(--header-border))] flex items-center justify-between px-4 py-2.5 shadow-sm">
        <Link to="/" className="flex items-center gap-2 font-semibold text-lg text-white tracking-tight">
          <span className="w-7 h-7 rounded-lg bg-cyan-500/20 flex items-center justify-center text-cyan-400 text-sm" aria-hidden>◇</span>
          ChatKit 工作台
        </Link>
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

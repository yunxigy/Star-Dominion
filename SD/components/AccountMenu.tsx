import { LogIn, LogOut, ShieldCheck, UserRound } from 'lucide-react';
import { Link } from 'react-router-dom';

import { useAuth } from '../context/AuthContext';


export function AccountMenu() {
  const { user, loading, logout } = useAuth();

  if (loading) {
    return <div className="px-3 py-2 text-sm text-[#8b735c]">正在确认登录状态…</div>;
  }

  if (!user) {
    return (
      <Link to="/auth/login" className="sidebar-item" aria-label="登录全站账号">
        <LogIn className="h-4 w-4" />
        <span className="flex-1 font-medium">登录</span>
      </Link>
    );
  }

  return (
    <div className="rounded-xl border border-[#dcc2a3] bg-[#fff4e6]/80 p-3">
      <div className="flex items-center gap-2">
        <UserRound className="h-4 w-4 text-[#8a4b1f]" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-[#2f241b]">
          {user.username}
        </span>
        {user.role === 'admin' && (
          <ShieldCheck className="h-4 w-4 text-[#5f6f42]" aria-label="管理员" />
        )}
      </div>
      <button
        type="button"
        onClick={() => void logout()}
        className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm text-[#6d5a47] transition-colors hover:bg-[#f1dcc2] hover:text-[#2f241b]"
      >
        <LogOut className="h-4 w-4" />
        退出登录
      </button>
    </div>
  );
}

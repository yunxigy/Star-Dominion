import { FormEvent, useEffect, useState } from 'react';
import { ArrowLeft, Loader2, LockKeyhole } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { useAuth } from '../context/AuthContext';
import { safeNextPath } from '../lib/siteAuth';


export function LoginPage() {
  const { user, loading, login } = useAuth();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [identity, setIdentity] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const next = safeNextPath(searchParams.get('next'));

  useEffect(() => {
    if (!loading && user) navigate(next, { replace: true });
  }, [loading, navigate, next, user]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(identity.trim(), password);
      navigate(next, { replace: true });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '登录失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-5xl items-center justify-center px-4 py-10">
      <section className="w-full max-w-md rounded-3xl border border-[#dcc2a3] bg-[#fffaf3]/95 p-7 shadow-xl shadow-[#9a5a28]/10 sm:p-9">
        <div className="mb-7 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#f1dcc2] text-[#8a4b1f]">
          <LockKeyhole className="h-6 w-6" />
        </div>
        <h1 className="text-2xl font-bold text-[#2f241b]">登录逐梦工具箱</h1>
        <p className="mt-2 text-sm leading-6 text-[#6d5a47]">
          一个账号可用于守岸人、股票详细分析、模型 API 配置和管理功能。
        </p>

        <form className="mt-7 space-y-5" onSubmit={handleSubmit}>
          <div>
            <label htmlFor="identity" className="mb-2 block text-sm font-medium text-[#49392d]">
              用户名或邮箱
            </label>
            <input
              id="identity"
              name="identity"
              type="text"
              autoComplete="username"
              required
              value={identity}
              onChange={(event) => setIdentity(event.target.value)}
              className="w-full rounded-xl border border-[#d8b58e] bg-white px-4 py-3 text-[#2f241b] outline-none transition focus:border-[#9a5a28] focus:ring-2 focus:ring-[#9a5a28]/15"
            />
          </div>
          <div>
            <label htmlFor="password" className="mb-2 block text-sm font-medium text-[#49392d]">
              密码
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-xl border border-[#d8b58e] bg-white px-4 py-3 text-[#2f241b] outline-none transition focus:border-[#9a5a28] focus:ring-2 focus:ring-[#9a5a28]/15"
            />
          </div>

          {error && (
            <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting || !identity.trim() || !password}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#8a4b1f] px-4 py-3 font-semibold text-white transition hover:bg-[#6f3714] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {submitting ? '登录中…' : '登录'}
          </button>
        </form>

        <div className="mt-6 border-t border-[#ead6bd] pt-5">
          <Link to="/" className="inline-flex items-center gap-2 text-sm text-[#6d5a47] hover:text-[#8a4b1f]">
            <ArrowLeft className="h-4 w-4" />
            返回公开首页
          </Link>
        </div>
      </section>
    </div>
  );
}


import { Link } from 'react-router-dom';

export function LoginPage() {
  const target = import.meta.env.VITE_LOGIN_URL?.trim();
  return (
    <section className="mx-auto max-w-lg space-y-5 p-8">
      <h1 className="text-2xl font-bold">登录全站账号</h1>
      <p>{target ? '请前往登录页面完成登录，然后返回工具箱。' : '登录入口暂不可用，请联系管理员。公开工具仍可正常使用。'}</p>
      {target && <a href={target} className="inline-block rounded-lg bg-[#392b20] px-5 py-3 text-white">前往登录</a>}
      <Link to="/" className="block underline">返回工具箱</Link>
    </section>
  );
}

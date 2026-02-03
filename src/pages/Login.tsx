import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { useAuthStore } from '../stores/auth.js';

type Form = { account: string; password: string; persist?: boolean };

export function Login() {
  const navigate = useNavigate();
  const { login, isLoading, error } = useAuthStore();
  const [msg, setMsg] = useState<string | null>(null);

  const { register, handleSubmit, formState: { errors } } = useForm<Form>();

  const onSubmit = async (data: Form) => {
    setMsg(null);
    const { account, password, persist } = data;
    const payload: { password: string; email?: string; username?: string; phone_number?: string } = { password };
    if (/@/.test(account)) payload.email = account;
    else if (/^\d+$/.test(account)) payload.phone_number = account;
    else payload.username = account;

    try {
      await login(payload, !!persist);
      navigate('/', { replace: true });
    } catch {
      setMsg(error || '登录失败');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 p-4">
      <div className="w-full max-w-md bg-white rounded-lg shadow p-6">
        <h1 className="text-2xl font-semibold text-center mb-6">ChatKit Web</h1>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">账号（邮箱 / 用户名 / 手机号）</label>
            <input
              {...register('account', { required: '请填写账号' })}
              className="w-full border border-gray-300 rounded px-3 py-2"
              placeholder="邮箱、用户名或手机号"
            />
            {errors.account && <p className="text-red-500 text-sm mt-1">{errors.account.message}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">密码</label>
            <input
              type="password"
              {...register('password', { required: '请填写密码' })}
              className="w-full border border-gray-300 rounded px-3 py-2"
            />
            {errors.password && <p className="text-red-500 text-sm mt-1">{errors.password.message}</p>}
          </div>
          <div className="flex items-center">
            <input type="checkbox" {...register('persist')} id="persist" className="mr-2" />
            <label htmlFor="persist" className="text-sm text-gray-600">记住我</label>
          </div>
          {(error || msg) && <p className="text-red-500 text-sm">{msg || error}</p>}
          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {isLoading ? '登录中…' : '登录'}
          </button>
        </form>
        <p className="mt-4 text-center text-sm text-gray-600">
          还没有账号？ <Link to="/register" className="text-blue-600 hover:underline">去注册</Link>
        </p>
      </div>
    </div>
  );
}

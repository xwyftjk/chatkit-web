import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { useAuthStore } from '../stores/auth.js';

type Form = {
  email?: string;
  phone_number?: string;
  password: string;
  name?: string;
  username?: string;
};

export function Register() {
  const navigate = useNavigate();
  const { register: apiRegister, isLoading, error } = useAuthStore();
  const [msg, setMsg] = useState<string | null>(null);

  const { register, handleSubmit, formState: { errors } } = useForm<Form>();

  const onSubmit = async (data: Form) => {
    setMsg(null);
    const email = data.email?.trim() || undefined;
    const phone_number = data.phone_number?.trim() || undefined;
    if (!email && !phone_number) {
      setMsg('请填写邮箱或手机号至少其一');
      return;
    }
    try {
      const payload: Parameters<typeof apiRegister>[0] = {
        password: data.password,
      };
      if (email) payload.email = email;
      if (phone_number) payload.phone_number = phone_number;
      if (data.name?.trim()) payload.name = data.name.trim();
      if (data.username?.trim()) payload.username = data.username.trim();
      await apiRegister(payload);
      setMsg('注册成功，请登录');
      navigate('/login', { replace: true });
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '注册失败');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 p-4">
      <div className="w-full max-w-md bg-white rounded-lg shadow p-6">
        <h1 className="text-2xl font-semibold text-center mb-6">ChatKit Web · 注册</h1>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">邮箱（选填）</label>
            <input
              type="email"
              {...register('email')}
              className="w-full border border-gray-300 rounded px-3 py-2"
              placeholder="email@example.com"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">手机号（选填）</label>
            <input
              {...register('phone_number')}
              className="w-full border border-gray-300 rounded px-3 py-2"
              placeholder="手机号"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">密码（≥8 位，必填）</label>
            <input
              type="password"
              {...register('password', { required: '请填写密码', minLength: { value: 8, message: '至少 8 位' } })}
              className="w-full border border-gray-300 rounded px-3 py-2"
            />
            {errors.password && <p className="text-red-500 text-sm mt-1">{errors.password.message}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">姓名（选填）</label>
            <input {...register('name')} className="w-full border border-gray-300 rounded px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">用户名（选填，3–50 位）</label>
            <input {...register('username')} className="w-full border border-gray-300 rounded px-3 py-2" />
          </div>
          {(error || msg) && <p className="text-red-500 text-sm">{msg || error}</p>}
          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {isLoading ? '注册中…' : '注册'}
          </button>
        </form>
        <p className="mt-4 text-center text-sm text-gray-600">
          已有账号？ <Link to="/login" className="text-blue-600 hover:underline">去登录</Link>
        </p>
      </div>
    </div>
  );
}

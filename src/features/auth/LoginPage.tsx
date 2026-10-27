import { useEffect, useState, type FormEvent } from 'react';
import { ArrowRight, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { BrandMark } from '@/components/brand';
import { useAuth } from '@/state/AuthContext.tsx';
import { api } from '@/data/api';
import './login.css';

export function LoginPage() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [options, setOptions] = useState<{ allowSignup: boolean; bootstrap: boolean } | null>(null);
  useEffect(() => {
    let alive = true;
    void api
      .authOptions()
      .then((value) => {
        if (alive) setOptions(value);
      })
      .catch(() => {
        if (alive) setError('暂时无法读取登录设置，请刷新重试');
      });
    return () => {
      alive = false;
    };
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const message = mode === 'login' ? await signIn(email, password) : await signUp(email, password);
    setBusy(false);
    if (message) setError(message);
  };

  return (
    <div className="login-page">
      <div className="login-background" aria-hidden="true">
        <img src="/images/login-mountains.webp" alt="" fetchPriority="high" decoding="async" />
      </div>
      <header className="login-brand">
        <BrandMark size={36} />
        <span>研序</span>
      </header>
      <main className="login-main">
        <section className="login-form-panel" aria-labelledby="login-title">
          <div className="login-form-heading">
            <h1 id="login-title">{mode === 'login' ? '欢迎回来' : '创建账号'}</h1>
            {mode === 'signup' && options?.bootstrap && <p>首个账号将成为平台所有者。</p>}
          </div>
          <form className="flex flex-col gap-4" onSubmit={submit}>
            <Field label="邮箱">
              {(id) => (
                <Input
                  id={id}
                  type="email"
                  placeholder="name@example.com"
                  value={email}
                  autoComplete="username"
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              )}
            </Field>
            <Field label="密码">
              {(id) => (
                <div className="relative">
                  <Input
                    id={id}
                    type={showPassword ? 'text' : 'password'}
                    placeholder={mode === 'signup' ? '设置密码' : '输入密码'}
                    value={password}
                    autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                    minLength={mode === 'signup' ? 10 : undefined}
                    maxLength={200}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pr-11"
                    required
                  />
                  <button
                    type="button"
                    aria-label={showPassword ? '隐藏密码' : '显示密码'}
                    onClick={() => setShowPassword(!showPassword)}
                    className="login-password-toggle"
                  >
                    {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              )}
            </Field>
            {mode === 'signup' && (
              <p className="text-[11px] leading-6 text-ink-2">密码至少 10 个字符，包含大小写、数字、符号中的两类。</p>
            )}

            {error && (
              <p
                className="rounded-control border border-danger-soft bg-danger-soft px-3 py-2 text-aux text-danger"
                role="alert"
              >
                {error}
              </p>
            )}

            <Button type="submit" variant="primary" className="login-submit" disabled={busy || !email || !password}>
              {busy ? '正在处理…' : mode === 'login' ? '登录' : '创建账号'}
              {!busy && <ArrowRight size={15} aria-hidden />}
            </Button>
          </form>
          {options?.allowSignup ? (
            <div className="login-switch">
              <span>{mode === 'login' ? '还没有账号？' : '已有账号？'}</span>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setMode(mode === 'login' ? 'signup' : 'login');
                  setError(null);
                  setShowPassword(false);
                }}
              >
                {mode === 'login' ? '注册' : '返回登录'}
              </button>
            </div>
          ) : (
            options && <p className="login-account-note">账号由管理员创建</p>
          )}
        </section>
      </main>
    </div>
  );
}

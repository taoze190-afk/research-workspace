import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bot } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast';
import { AI_PRESETS, aiChat, aiReady, loadAiConfig, saveAiConfig, type AiConfig } from '@/lib/ai';
import { cn } from '@/lib/cx';
import { useAuth } from '@/state/AuthContext';
import { api } from '@/data/api';
import { canManagePlatform, type PlatformAiConfig } from '@/domain/platform';

/**
 * 个人接口按账号存储在浏览器；平台模型通过服务端网关。两者均不把密钥放进科研备份。
 * 兼容 OpenAI 协议的服务都能填（DeepSeek / GLM / Kimi / OpenAI / 本地 Ollama）。
 */
export function AiSection() {
  const toast = useToast();
  const [config, setConfig] = useState<AiConfig>(() => loadAiConfig());
  const [preset, setPreset] = useState<string>('');
  const [testing, setTesting] = useState(false);
  const auth = useAuth();
  const [platform, setPlatform] = useState<PlatformAiConfig | null>(null);
  const [platformError, setPlatformError] = useState('');
  useEffect(() => {
    let alive = true;
    if (auth.phase === 'signed-in')
      void api
        .platformAi()
        .then((value) => {
          if (alive) setPlatform(value);
        })
        .catch((err: Error) => {
          if (alive) setPlatformError(err.message);
        });
    return () => {
      alive = false;
    };
  }, [auth.phase]);

  const update = (patch: Partial<AiConfig>) => {
    const next = { ...config, ...patch };
    setConfig(next);
    saveAiConfig(next);
  };

  const applyPreset = (id: string) => {
    const p = AI_PRESETS.find((x) => x.id === id);
    if (!p) return;
    setPreset(id);
    update({ baseUrl: p.baseUrl, model: p.model });
  };

  const test = async () => {
    if (!aiReady(config)) {
      toast({ title: '先打开开关并填好地址与模型', tone: 'error' });
      return;
    }
    setTesting(true);
    try {
      const reply = await aiChat(config, [{ role: 'user', content: '回复「连接正常」四个字' }], { timeoutMs: 30000 });
      toast({ title: '连接成功', description: reply.slice(0, 40), tone: 'success' });
    } catch (error) {
      toast({ title: '连接失败', description: (error as Error).message, tone: 'error', duration: 9000 });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="divide-y divide-line">
      {auth.phase === 'signed-in' && (
        <div className="flex items-center gap-2 px-3.5 py-3">
          {(
            [
              ['platform', '平台模型'],
              ['personal', '个人接口'],
            ] as const
          ).map(([value, title]) => (
            <Button
              size="sm"
              key={value}
              variant={(config.mode ?? 'personal') === value ? 'primary' : 'secondary'}
              aria-pressed={(config.mode ?? 'personal') === value}
              onClick={() => update({ mode: value, ...(value === 'platform' ? { enabled: true } : {}) })}
            >
              {title}
            </Button>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
        <span className="text-body">启用 AI 副驾驶</span>
        <Switch checked={config.enabled} onCheckedChange={(v) => update({ enabled: v })} label="启用 AI 副驾驶" />
      </div>

      {config.mode === 'platform' ? (
        <div className="px-3.5 py-4">
          <p className="text-body font-medium">
            {platform?.enabled && platform.configured ? platform.model : '平台模型尚未就绪'}
          </p>
          <p className="mt-2 text-aux leading-7 text-ink-2">
            {platformError ||
              (platform?.aiAllowed === false
                ? '你的平台 AI 权限未开通，请联系管理员。'
                : '由管理员统一配置，服务密钥保存在服务器。')}
          </p>
          <Link
            to={canManagePlatform(auth.user?.role) ? '/admin?tab=models' : '/ai'}
            className="mt-3 inline-block text-aux text-brand"
          >
            {canManagePlatform(auth.user?.role) ? '管理平台模型 →' : '进入 AI 工作室 →'}
          </Link>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-1.5 px-3.5 py-2.5">
            {AI_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                aria-pressed={preset === p.id}
                onClick={() => applyPreset(p.id)}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-aux transition-colors duration-150',
                  preset === p.id
                    ? 'border-brand bg-brand-soft font-medium text-brand-ink'
                    : 'border-line text-ink-2 hover:bg-surface-subtle',
                )}
              >
                <Bot size={11} aria-hidden />
                {p.label}
              </button>
            ))}
          </div>

          <div className="grid gap-2.5 px-3.5 py-3 sm:grid-cols-2">
            <Field label="接口地址">
              {(id) => (
                <Input
                  id={id}
                  value={config.baseUrl}
                  placeholder="https://api.deepseek.com/v1"
                  onChange={(e) => update({ baseUrl: e.target.value })}
                />
              )}
            </Field>
            <Field label="模型名">
              {(id) => (
                <Input
                  id={id}
                  value={config.model}
                  placeholder="deepseek-chat"
                  onChange={(e) => update({ model: e.target.value })}
                />
              )}
            </Field>
            <Field label="API Key">
              {(id) => (
                <Input
                  id={id}
                  type="password"
                  autoComplete="off"
                  value={config.apiKey}
                  placeholder="只存在这台浏览器"
                  onChange={(e) => update({ apiKey: e.target.value })}
                />
              )}
            </Field>
            <div className="flex items-end pb-0.5">
              <Button variant="secondary" size="sm" disabled={testing} onClick={() => void test()}>
                {testing ? '正在测试…' : '测试连接'}
              </Button>
            </div>
          </div>

          <p className="px-3.5 py-2.5 text-aux text-ink-2">密钥仅保存在当前浏览器，不随备份导出。</p>
        </>
      )}
    </div>
  );
}

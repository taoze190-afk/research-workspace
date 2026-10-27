import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { BrandMark } from '@/components/brand';
import { setPrefs } from '@/lib/prefs';
import { loadDemoData } from '@/data/demo';
import { useData } from '@/state/DataContext';
import { useToast } from '@/components/ui/toast';

export function WelcomeGate() {
  const navigate = useNavigate();
  const { mutate } = useData();
  const toast = useToast();
  const [busy, setBusy] = useState<'start' | 'demo' | null>(null);

  const start = () => {
    setPrefs({ demoLoadedAt: Date.now() });
    navigate('/projects');
  };

  const tryDemo = async () => {
    setBusy('demo');
    let result: { loaded: boolean; reason?: string } = { loaded: false };
    await mutate(
      async () => {
        result = await loadDemoData();
      },
      { silent: true }
    );
    setBusy(null);
    if (!result.loaded) toast({ title: '没有重复插入示例数据', description: result.reason, tone: 'info' });
    else toast({ title: '示例数据已载入', tone: 'success' });
    navigate('/');
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-app-bg px-4 py-10">
      <div className="w-full max-w-[340px]">
        <div className="mb-8 flex flex-col items-center gap-3">
          <BrandMark size={44} />
          <h1 className="text-[19px] font-semibold tracking-tight">研序</h1>
        </div>

        <div className="flex flex-col gap-2">
          <Button variant="primary" className="w-full" onClick={start} disabled={busy !== null}>
            开始使用
          </Button>
          <Button variant="secondary" className="w-full" onClick={() => void tryDemo()} disabled={busy !== null}>
            {busy === 'demo' ? '正在载入示例…' : '体验示例'}
          </Button>
        </div>
      </div>
    </div>
  );
}

import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** 无效 ID 或未知路径都落到这里，给出明确返回入口。 */
export function NotFoundPage({ what = '页面', backTo = '/', backLabel = '回到工作台' }: { what?: string; backTo?: string; backLabel?: string }) {
  const params = useParams();
  const id = params.experimentId ?? params.projectId;
  return (
    <div className="flex min-h-[46vh] items-center">
      <div className="w-full max-w-[460px]">
        <div className="page-head">
          <h1 className="page-title">
            <span>找不到这条{what}</span>
          </h1>
        </div>
        <p className="mt-1 text-body text-ink-2">{id ? '这条记录不存在，或已被彻底删除。' : '这个地址不对，换一个入口进去。'}</p>
        <Button asChild variant="primary" size="sm" className="mt-4">
          <Link to={backTo}>
            <ArrowLeft size={15} aria-hidden />
            {backLabel}
          </Link>
        </Button>
      </div>
    </div>
  );
}

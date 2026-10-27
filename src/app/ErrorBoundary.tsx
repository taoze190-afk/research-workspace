import { Component, type ErrorInfo, type ReactNode } from 'react';
import { TriangleAlert } from 'lucide-react';

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

/** 渲染期异常不该只剩空白页：把错误文本显示出来，并给出返回入口。 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('界面渲染出错', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex min-h-screen items-center justify-center bg-app-bg p-6">
        <div className="panel w-full max-w-[560px] p-6">
          <div className="flex items-center gap-2 text-danger">
            <TriangleAlert size={18} aria-hidden />
            <h1 className="text-section font-semibold">页面出错了</h1>
          </div>
          <p className="mt-2 text-body text-ink-2">
            这一屏渲染时抛了异常。你已保存的数据没有受影响，仍在浏览器本地库里。
          </p>
          <pre className="scrollbar-thin mt-3 max-h-[180px] overflow-auto rounded-control border border-line bg-surface-subtle p-3 text-aux">
            {this.state.error.message}
          </pre>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              className="btn h-9 rounded-control border border-line bg-surface px-3.5 text-body hover:bg-surface-subtle"
              onClick={() => {
                window.location.hash = '';
                window.location.pathname = '/';
              }}
            >
              回到工作台
            </button>
            <button
              type="button"
              className="btn h-9 rounded-control bg-brand px-3.5 text-body font-medium text-white hover:bg-brand-ink"
              onClick={() => window.location.reload()}
            >
              重新加载
            </button>
          </div>
        </div>
      </div>
    );
  }
}

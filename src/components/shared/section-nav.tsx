import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cx';

/** 文档与设置共用的页内目录；滚动时跟随当前分区，不占用正文空间。 */
export function SectionNav({
  items,
  label,
  className,
}: {
  items: { id: string; label: string }[];
  label: string;
  className?: string;
}) {
  const key = items.map((item) => item.id).join('|');
  const [active, setActive] = useState(items[0]?.id);
  const requested = useRef<{ id: string; top: number } | null>(null);
  useEffect(() => {
    const main = document.getElementById('main-content');
    const ids = key.split('|');
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // 末尾分区不一定能顶齐视口；目录点击后保留用户选择，直到再次手动滚动。
        if (main && requested.current && Math.abs(main.scrollTop - requested.current.top) < 2) {
          setActive(requested.current.id);
          return;
        }
        requested.current = null;
        const top = (main?.getBoundingClientRect().top ?? 0) + 110;
        const sections = ids.map((id) => document.getElementById(id)).filter((el): el is HTMLElement => !!el);
        const atBottom = main && main.scrollTop > 0 && main.scrollTop + main.clientHeight >= main.scrollHeight - 2;
        const current = atBottom
          ? sections.at(-1)
          : (sections.filter((el) => el.getBoundingClientRect().top <= top).at(-1) ?? sections[0]);
        if (current) setActive(current.id);
      });
    };
    update();
    main?.addEventListener('scroll', update, { passive: true });
    return () => {
      main?.removeEventListener('scroll', update);
      cancelAnimationFrame(frame);
    };
  }, [key]);
  return (
    <nav className={cn('section-nav', className)} aria-label={label}>
      {items.map((item, index) => (
        <a
          key={item.id}
          href={'#' + item.id}
          aria-current={active === item.id ? 'location' : undefined}
          onClick={(event) => {
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            const section = document.getElementById(item.id);
            if (!section) return;
            event.preventDefault();
            setActive(item.id);
            section.scrollIntoView({ block: 'start' });
            const main = document.getElementById('main-content');
            if (main) requested.current = { id: item.id, top: main.scrollTop };
          }}
        >
          <span aria-hidden>{String(index + 1).padStart(2, '0')}</span>
          {item.label}
        </a>
      ))}
    </nav>
  );
}

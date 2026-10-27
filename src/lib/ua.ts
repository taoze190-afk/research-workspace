/**
 * 把会话记录里的 User-Agent 摘成一行人话：「Chrome · Windows」。
 * 只做展示用，解析不出就说是未知设备，不瞎猜。
 */

const BROWSERS: [RegExp, string][] = [
  [/Edg(?:e|A|iOS)?\/([\d.]+)/, 'Edge'],
  [/OPR\/([\d.]+)/, 'Opera'],
  [/Firefox\/([\d.]+)/, 'Firefox'],
  [/(?:Headless)?Chrome\/([\d.]+)/, 'Chrome'],
  [/Safari\/([\d.]+)/, 'Safari'],
];

const SYSTEMS: [RegExp, string][] = [
  [/Windows NT 10\.0/, 'Windows'],
  [/Windows/, 'Windows'],
  [/Android/, 'Android'],
  [/(?:iPhone|iPad|iPod)/, 'iOS'],
  [/Mac OS X/, 'macOS'],
  [/Linux/, 'Linux'],
];

export function describeUserAgent(ua: string | null | undefined): string {
  const raw = (ua ?? '').trim();
  if (!raw) return '未知设备';
  const browser = BROWSERS.find(([re]) => re.test(raw))?.[1];
  const system = SYSTEMS.find(([re]) => re.test(raw))?.[1];
  if (!browser && !system) return '未知设备';
  return [browser, system].filter(Boolean).join(' · ');
}

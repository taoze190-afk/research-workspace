import { describe, expect, it } from 'vitest';
import { describeUserAgent } from '@/lib/ua';

describe('User-Agent 摘要', () => {
  it('常见桌面浏览器', () => {
    expect(describeUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36')).toBe('Chrome · Windows');
    expect(describeUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0')).toBe('Edge · Windows');
    expect(describeUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:127.0) Gecko/20100101 Firefox/127.0')).toBe('Firefox · macOS');
  });

  it('移动端与未知', () => {
    expect(describeUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36')).toBe('Chrome · Android');
    expect(describeUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1')).toBe('Safari · iOS');
    expect(describeUserAgent('')).toBe('未知设备');
    expect(describeUserAgent(null)).toBe('未知设备');
    expect(describeUserAgent('some-crawler/1.0')).toBe('未知设备');
  });
});

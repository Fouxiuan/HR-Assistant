export type NeteaseProviderKey =
  | '163'
  | '126'
  | '188'
  | 'vip163'
  | 'vip126'
  | 'netease-enterprise';

export interface MailProviderPreset {
  key: NeteaseProviderKey;
  label: string;
  host: string;
  port: number;
  secure: boolean;
}

export const NETEASE_PROVIDERS: Record<NeteaseProviderKey, MailProviderPreset> = {
  '163': { key: '163', label: '网易 163 邮箱', host: 'imap.163.com', port: 993, secure: true },
  '126': { key: '126', label: '网易 126 邮箱', host: 'imap.126.com', port: 993, secure: true },
  '188': { key: '188', label: '网易 188 邮箱', host: 'imap.188.com', port: 993, secure: true },
  vip163: { key: 'vip163', label: '网易 VIP 163 邮箱', host: 'imap.vip.163.com', port: 993, secure: true },
  vip126: { key: 'vip126', label: '网易 VIP 126 邮箱', host: 'imap.vip.126.com', port: 993, secure: true },
  'netease-enterprise': {
    key: 'netease-enterprise',
    label: '网易企业邮箱',
    host: 'imap.qiye.163.com',
    port: 993,
    secure: true,
  },
};

export function isNeteaseProvider(value: unknown): value is NeteaseProviderKey {
  return typeof value === 'string' && value in NETEASE_PROVIDERS;
}

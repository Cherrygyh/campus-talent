import type { Metadata } from 'next';
import { APP_VERSION } from '../lib/version';
import './globals.css';

export const metadata: Metadata = {
  title: '拾才 · 招新面试工作台',
  description: '导入报名表、快速点名、记录面试评价，管理工作室与社团招新。',
  other: { 'application-version': APP_VERSION },
  icons: {
    icon: '/favicon.svg',
    shortcut: '/favicon.svg',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}

import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Model Index · 本地 AI 模型库",
  description: "本地运行的 AI 模型资料库与渠道目录",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}

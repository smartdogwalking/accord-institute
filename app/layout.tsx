import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Accord Institute — Private",
  description: "Agreement intelligence with guided analysis and source-linked review",
};
export default function Layout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

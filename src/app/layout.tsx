import type { Metadata } from "next";
import { loadBusinessConfig } from "@/config/business";
import { Sidebar } from "@/components/sidebar";
import "@/app/globals.css";

export const metadata: Metadata = {
  title: "Prospecção comercial",
  description: "Operação local e auditável de prospecção no Instagram"
};

export default function RootLayout({
  children
}: Readonly<{ children: React.ReactNode }>) {
  const result = loadBusinessConfig();
  const companyName = result.config?.company.name ?? "Sistema comercial";
  const instagramHandle = result.config?.company.instagramHandle ?? null;

  return (
    <html lang="pt-BR">
      <body>
        <div className="app-shell">
          <Sidebar
            companyName={companyName}
            instagramHandle={instagramHandle}
          />
          <main className="content-shell">{children}</main>
        </div>
      </body>
    </html>
  );
}

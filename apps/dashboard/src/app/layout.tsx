import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";
import { SesionProvider } from "@/lib/SesionProvider";
import { GuardaSesion } from "@/components/GuardaSesion";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Panel de Despachos",
  description: "Control logístico multi-sede — entregas y auditoría en tiempo real.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="es"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <SesionProvider>
          <GuardaSesion>{children}</GuardaSesion>
        </SesionProvider>
        <Toaster
          theme="dark"
          toastOptions={{
            style: {
              background: "var(--color-surface)",
              border: "1px solid var(--color-line-strong)",
              borderRadius: "0.75rem",
              color: "var(--color-ink)",
            },
          }}
        />
      </body>
    </html>
  );
}

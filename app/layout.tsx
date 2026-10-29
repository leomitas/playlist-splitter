import type { Metadata } from "next";
import { Archivo, Atkinson_Hyperlegible } from "next/font/google";
import { DEFAULT_LOCALE, translate } from "@/lib/i18n";
import { BOOT_SCRIPT } from "./boot-script";
import "./globals.css";

// display: variable width axis, condensed for numbers and expanded for the wordmark
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  axes: ["wdth"],
});

const atkinson = Atkinson_Hyperlegible({
  variable: "--font-atkinson",
  subsets: ["latin"],
  weight: ["400", "700"],
});

export const metadata: Metadata = {
  title: "Playlist Splitter",
  // the server renders the default language; the description stays in it
  description: translate(DEFAULT_LOCALE, "meta.description"),
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // the head script sets data-theme and lang before hydration, hence suppressHydrationWarning
    <html
      lang="pt-BR"
      className={`${archivo.variable} ${atkinson.variable} min-h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: BOOT_SCRIPT }} />
      </head>
      <body className="flex min-h-dvh flex-col">{children}</body>
    </html>
  );
}

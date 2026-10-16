import type { Metadata } from "next";
import { Archivo, Atkinson_Hyperlegible } from "next/font/google";
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
  description: "Separa as músicas das suas playlists do Spotify por gênero e cria playlists novas.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className={`${archivo.variable} ${atkinson.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}

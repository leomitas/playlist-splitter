// Short walkthrough videos for /setup. Put the file in public/videos/ and set its path here
// (e.g. "/videos/spotify-dashboard.mp4"); null shows a placeholder.
export const VIDEOS: Record<"spotify" | "lastfm" | "env", { title: string; src: string | null }> = {
  spotify: { title: "Criar o app no Spotify Dashboard", src: null },
  lastfm: { title: "Criar a chave do Last.fm", src: null },
  env: { title: "Montar o .env.local e reiniciar", src: null },
};

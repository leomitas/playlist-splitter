import NextAuth, { type NextAuthConfig } from "next-auth";
import Spotify from "next-auth/providers/spotify";

const SCOPES = [
  "user-read-email",
  "playlist-read-private",
  "playlist-read-collaborative",
  "playlist-modify-public",
  "playlist-modify-private",
].join(" ");

declare module "next-auth" {
  interface Session {
    accessToken?: string;
    error?: "RefreshTokenError";
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    access_token?: string;
    refresh_token?: string;
    expires_at?: number;
    error?: "RefreshTokenError";
  }
}

export const authConfig: NextAuthConfig = {
  basePath: "/api/auth",
  providers: [
    Spotify({
      authorization: {
        url: "https://accounts.spotify.com/authorize",
        params: { scope: SCOPES },
      },
    }),
  ],
  // Auth.js errors land on the home page as ?error=... so they show up in the UI
  pages: { signIn: "/", error: "/" },
  callbacks: {
    async jwt({ token, account }) {
      if (account) {
        return {
          ...token,
          access_token: account.access_token,
          refresh_token: account.refresh_token,
          expires_at: account.expires_at,
        };
      }

      // 60s margin so the token doesn't expire mid-request
      if (token.expires_at && Date.now() < (token.expires_at - 60) * 1000) {
        return token;
      }

      if (!token.refresh_token) {
        return { ...token, error: "RefreshTokenError" };
      }

      try {
        const basic = Buffer.from(
          `${process.env.AUTH_SPOTIFY_ID}:${process.env.AUTH_SPOTIFY_SECRET}`,
        ).toString("base64");
        const res = await fetch("https://accounts.spotify.com/api/token", {
          method: "POST",
          headers: {
            Authorization: `Basic ${basic}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: token.refresh_token,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw data;

        return {
          ...token,
          access_token: data.access_token,
          expires_at: Math.floor(Date.now() / 1000) + data.expires_in,
          // Spotify may omit refresh_token on refresh; keep the old one
          refresh_token: data.refresh_token ?? token.refresh_token,
          error: undefined,
        };
      } catch (err) {
        console.error("[auth] Spotify token refresh failed:", err);
        return { ...token, error: "RefreshTokenError" };
      }
    },
    async session({ session, token }) {
      session.accessToken = token.access_token;
      session.error = token.error;
      return session;
    },
  },
};

export const { auth, signIn, signOut } = NextAuth(authConfig);

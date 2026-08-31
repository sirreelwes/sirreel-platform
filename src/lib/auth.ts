import { NextAuthOptions } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import prisma from './prisma';
import { isAllowedEmailDomain } from './authDomains';

/**
 * NOTE — these options do NOT serve sign-in today.
 *
 * The NextAuth route handler at src/app/api/auth/[...nextauth]/route.ts
 * declares its own inline config (different Google client env vars:
 * GOOGLE_CLIENT_ID/SECRET rather than AUTH_GOOGLE_ID/SECRET) and never
 * imports this object. So `providers` and `signIn` here are inert; what this
 * object is actually used for is `getServerSession(authOptions)` in ~66
 * routes, where only the `session` callback runs.
 *
 * Both configs now share the same domain predicate so they cannot diverge,
 * but consolidating them onto one config is separate, riskier work.
 */
export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.AUTH_GOOGLE_ID!,
      clientSecret: process.env.AUTH_GOOGLE_SECRET!,
      authorization: {
        params: {
          scope: 'openid email profile https://www.googleapis.com/auth/gmail.readonly',
          // No `hd` here on purpose. Google's hosted-domain param takes a
          // SINGLE domain, so it would hide every non-sirreel.com account from
          // the picker entirely — a second allowed domain could never appear.
          // Domain enforcement belongs in the signIn callback below, which
          // reads the full list from src/lib/authDomains.ts.
          prompt: 'consent',
          access_type: 'offline',
          response_type: 'code',
        },
      },
    }),
  ],

  callbacks: {
    async signIn({ user, account }) {
      if (!user.email) return false;

      // Same domain gate as the live handler in
      // src/app/api/auth/[...nextauth]/route.ts. This config does not
      // currently serve sign-in (see the note above authOptions), but
      // leaving it without a domain check is a trap for whoever wires it up.
      if (!isAllowedEmailDomain(user.email)) return false;

      // Check if user exists in our database
      const dbUser = await prisma.user.findUnique({
        where: { email: user.email },
      });

      if (!dbUser) {
        // Unknown email — deny access
        // (Admins must create users in the system first)
        return false;
      }

      // Update last login
      await prisma.user.update({
        where: { id: dbUser.id },
        data: { lastLoginAt: new Date() },
      });

      return true;
    },

    async session({ session }) {
      if (session.user?.email) {
        const dbUser = await prisma.user.findUnique({
          where: { email: session.user.email },
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            location: true,
            avatarUrl: true,
            // Phase 6.5 — surface + data scoping axes.
            salesOnly: true,
            dataScope: true,
          },
        });

        if (dbUser) {
          (session.user as any).id = dbUser.id;
          (session.user as any).role = dbUser.role;
          (session.user as any).location = dbUser.location;
          (session.user as any).salesOnly = dbUser.salesOnly;
          (session.user as any).dataScope = dbUser.dataScope;
          session.user.name = dbUser.name;
          session.user.image = dbUser.avatarUrl;
        }
      }

      return session;
    },

    async jwt({ token, account }) {
      // Store Google tokens for Gmail API access
      if (account) {
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token;
      }
      return token;
    },
  },

  pages: {
    signIn: '/login',
    error: '/login',
  },

  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
};

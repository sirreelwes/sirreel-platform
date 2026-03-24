import { NextAuthOptions } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import prisma from './prisma';

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.AUTH_GOOGLE_ID!,
      clientSecret: process.env.AUTH_GOOGLE_SECRET!,
      authorization: {
        params: {
          scope: 'openid email profile https://www.googleapis.com/auth/gmail.readonly',
          hd: 'sirreel.com', // Restrict to Google Workspace domain
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
          },
        });

        if (dbUser) {
          (session.user as any).id = dbUser.id;
          (session.user as any).role = dbUser.role;
          (session.user as any).location = dbUser.location;
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

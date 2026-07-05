import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

/**
 * Clerk protects the dashboard. Public surfaces:
 *  - landing + docs
 *  - /api/v1/* (API-key auth, not Clerk)
 *  - /api/inngest (Inngest signature auth)
 *  - /api/anaf/callback (signed state param; must stay lean for the 60s code window)
 */
const isPublicRoute = createRouteMatcher([
  '/',
  '/docs(.*)',
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/api/v1(.*)',
  '/api/inngest(.*)',
  '/api/anaf/callback(.*)',
]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};

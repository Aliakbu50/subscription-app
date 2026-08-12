/**
 * Session refresh for every request.
 *
 * Supabase access tokens are short-lived. Without this, a cashier who left the
 * app open on a shop tablet overnight would be silently signed out mid-rush —
 * the worst possible moment to discover it. This runs on every request, renews
 * the token when needed, and writes the refreshed cookies back.
 */
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // getUser() revalidates the token with Supabase. Do NOT swap this for
  // getSession(), which trusts whatever is in the cookie without checking.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isLoginPage = pathname === "/pos/login";

  // Everything under /pos requires a signed-in staff member.
  if (!user && pathname.startsWith("/pos") && !isLoginPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/pos/login";
    return NextResponse.redirect(url);
  }

  // Already signed in? Skip the login screen.
  if (user && isLoginPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/pos";
    return NextResponse.redirect(url);
  }

  return response;
}

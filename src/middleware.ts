import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Session refresh + route protection for the authenticated surfaces.
 * /t/[token] (customer tracking) and /api/* are intentionally NOT matched:
 * they authenticate by signed token / rider JWT / CRON_SECRET, never by
 * session cookie (SPEC.md section 2, auth model).
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(
          cookiesToSet: { name: string; value: string; options: CookieOptions }[],
        ) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // getUser() revalidates the JWT against Supabase Auth — do not swap for
  // getSession(), which trusts the cookie unverified.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isLoginPage = path === "/login" || path === "/rider/login";

  if (!user && !isLoginPage) {
    const url = request.nextUrl.clone();
    url.pathname = path.startsWith("/rider") ? "/rider/login" : "/login";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }

  if (user && isLoginPage) {
    const url = request.nextUrl.clone();
    url.pathname = path === "/rider/login" ? "/rider" : "/dispatch";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ["/dispatch/:path*", "/admin/:path*", "/rider/:path*", "/login"],
};

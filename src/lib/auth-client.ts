"use client";

/**
 * Auth client — wrapper de compatibilidade sobre Supabase.
 *
 * Exports compatíveis com a API anterior (better-auth):
 *   signIn.email({ email, password })
 *   signOut()
 *   useSession() → { data: { user } | null, isPending }
 */

import { useEffect, useState } from "react";
import { getSupabaseBrowser } from "./supabase/client";
import type { Session } from "@supabase/supabase-js";

const supabase = () => getSupabaseBrowser();

interface AppClientUser {
  id: string;
  email: string;
  name?: string;
}

export interface AppClientSession {
  user: AppClientUser;
}

function mapSession(s: Session | null): AppClientSession | null {
  if (!s?.user) return null;
  return {
    user: {
      id: s.user.id,
      email: s.user.email ?? "",
      name: (s.user.user_metadata?.name as string | undefined) ?? s.user.email ?? "user",
    },
  };
}

export const signIn = {
  email: async ({ email, password }: { email: string; password: string }) => {
    const { data, error } = await supabase().auth.signInWithPassword({ email, password });
    return { data: data.session ? mapSession(data.session) : null, error };
  },
};

export async function signOut() {
  const { error } = await supabase().auth.signOut();
  if (typeof window !== "undefined") {
    // força re-render da árvore
    window.location.href = "/login";
  }
  return { error };
}

export function useSession(): {
  data: AppClientSession | null;
  isPending: boolean;
} {
  const [state, setState] = useState<{ data: AppClientSession | null; isPending: boolean }>({
    data: null,
    isPending: true,
  });

  useEffect(() => {
    let mounted = true;

    supabase().auth.getSession().then(({ data }: { data: { session: Session | null } }) => {
      if (!mounted) return;
      setState({ data: mapSession(data.session), isPending: false });
    });

    const { data: listener } = supabase().auth.onAuthStateChange(
      (_event: string, session: Session | null) => {
        if (!mounted) return;
        setState({ data: mapSession(session), isPending: false });
      }
    );

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  return state;
}

export async function getSession() {
  const { data } = await supabase().auth.getSession();
  return { data: mapSession(data.session) };
}

// Re-export do client bruto pra casos que precisem
export const authClient = {
  getSession,
};

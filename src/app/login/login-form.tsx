"use client";

import { type FormEvent, useState } from "react";
import { Loader2, Mail } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { createClient } from "@/lib/supabase/client";

type Notice = { tone: "success" | "error"; message: string } | null;

const googleAuthEnabled = process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED === "true";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState<"email" | "google" | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  async function handleEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending("email");
    setNotice(null);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: window.location.origin + "/auth/callback?next=/dashboard",
        shouldCreateUser: true,
      },
    });

    setPending(null);
    setNotice(
      error
        ? { tone: "error", message: error.message }
        : { tone: "success", message: "Check your inbox for a secure sign-in link." },
    );
  }

  async function handleGoogle() {
    setPending("google");
    setNotice(null);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.origin + "/auth/callback?next=/dashboard",
      },
    });

    if (error) {
      setPending(null);
      setNotice({ tone: "error", message: error.message });
    }
  }

  return (
    <Card className="border-border/70 bg-card/85 shadow-2xl shadow-black/25 backdrop-blur-xl">
      <CardHeader>
        <CardTitle className="text-2xl">Racer access</CardTitle>
        <CardDescription>
          Sign in without a password. New racers can create an account from the same flow.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <form onSubmit={handleEmail} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email address</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="racer@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              disabled={pending !== null}
            />
          </div>
          <Button type="submit" className="w-full" disabled={pending !== null}>
            {pending === "email" ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Mail className="size-4" aria-hidden="true" />
            )}
            Email me a sign-in link
          </Button>
        </form>

        {googleAuthEnabled && (
          <>
            <div className="flex items-center gap-3">
              <Separator className="flex-1" />
              <span className="text-xs uppercase tracking-widest text-muted-foreground">or</span>
              <Separator className="flex-1" />
            </div>

            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={handleGoogle}
              disabled={pending !== null}
            >
              {pending === "google" && (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              )}
              Continue with Google
            </Button>
          </>
        )}

        {notice && (
          <Alert variant={notice.tone === "error" ? "destructive" : "default"}>
            <AlertTitle>{notice.tone === "error" ? "Sign-in failed" : "Link sent"}</AlertTitle>
            <AlertDescription>{notice.message}</AlertDescription>
          </Alert>
        )}
      </CardContent>
      <CardFooter className="text-xs leading-5 text-muted-foreground">
        By continuing, you agree to use published club and racer data responsibly.
      </CardFooter>
    </Card>
  );
}

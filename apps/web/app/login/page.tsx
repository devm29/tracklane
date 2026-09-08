"use client";

import type { DemoAccount } from "@tracklane/domain";
import { ChevronRight, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { UserAvatar } from "@/components/issue/user-avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, fetchDemoAccounts, login } from "@/lib/api";
import { saveSession, useSession } from "@/lib/session";

const DEMO_PASSWORD = "tracklane";

export default function LoginPage() {
  const router = useRouter();
  const session = useSession();
  const [accounts, setAccounts] = useState<DemoAccount[] | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (session) router.replace("/my-issues");
  }, [session, router]);

  useEffect(() => {
    fetchDemoAccounts()
      .then(setAccounts)
      .catch((reason: unknown) => {
        setAccounts([]);
        setError(reason instanceof ApiError ? reason.message : "Couldn't load demo accounts.");
      });
  }, []);

  const signIn = async (address: string, secret: string): Promise<void> => {
    setPending(address);
    setError(null);
    try {
      const result = await login(address, secret);
      saveSession(result);
      router.replace("/my-issues");
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "Something went wrong. Try again.");
      setPending(null);
    }
  };

  return (
    <main className="flex min-h-dvh items-center justify-center bg-secondary px-4 py-16 dark:bg-background">
      <div className="w-full max-w-[400px] space-y-8">
        <div className="space-y-3 text-center">
          <span className="mx-auto flex size-12 items-center justify-center rounded-[14px] bg-primary text-title2 font-semibold text-primary-foreground shadow-md">
            T
          </span>
          <h1 className="text-title1 leading-[2.125rem] font-semibold tracking-tight">Sign in to Tracklane</h1>
          <p className="text-subhead text-muted-foreground">Pick a teammate to explore the demo workspace. Open a second window as someone else to watch changes sync live.</p>
        </div>

        <section aria-label="Demo accounts">
          <h2 className="mb-1.5 px-4 text-caption2 font-medium tracking-wide text-muted-foreground uppercase">Demo accounts</h2>
          <ul className="divide-y divide-border overflow-hidden rounded-xl bg-card shadow-xs ring-1 ring-border/60">
            {accounts === null
              ? Array.from({ length: 4 }, (_, index) => (
                  <li key={index} className="flex h-14 items-center gap-3 px-4">
                    <Skeleton className="size-8 rounded-full" />
                    <Skeleton className="h-4 w-40" />
                  </li>
                ))
              : accounts.map((account) => (
                  <li key={account.email}>
                    <button
                      type="button"
                      disabled={pending !== null}
                      onClick={() => void signIn(account.email, DEMO_PASSWORD)}
                      className="flex min-h-14 w-full items-center gap-3 px-4 text-left transition-colors duration-150 hover:bg-accent/60 focus-visible:bg-accent/60 focus-visible:outline-none disabled:opacity-60"
                      data-testid={`demo-${account.email}`}
                    >
                      <UserAvatar user={account} size="md" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-subhead font-medium">{account.name}</span>
                        <span className="block truncate text-caption text-muted-foreground">{account.teams.join(" · ")}</span>
                      </span>
                      {pending === account.email ? (
                        <Loader2 className="size-4 animate-spin text-muted-foreground" />
                      ) : (
                        <ChevronRight className="size-4 text-muted-foreground" strokeWidth={1.75} />
                      )}
                    </button>
                  </li>
                ))}
          </ul>
        </section>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void signIn(email, password);
          }}
          className="space-y-4 rounded-xl bg-card p-5 shadow-xs ring-1 ring-border/60">
          <div className="space-y-1.5">
            <Label htmlFor="email" className="text-footnote">
              Email
            </Label>
            <Input id="email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="maya@lumen.dev" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password" className="text-footnote">
              Password
            </Label>
            <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
          </div>
          {error && (
            <p role="alert" className="text-caption text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={pending !== null}>
            {pending === email && <Loader2 className="animate-spin" />}
            Sign in
          </Button>
        </form>
        <p className="text-center text-caption text-muted-foreground">Every demo account uses the password “{DEMO_PASSWORD}”.</p>
      </div>
    </main>
  );
}

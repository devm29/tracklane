"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useSession } from "@/lib/session";

export default function Home() {
  const session = useSession();
  const router = useRouter();
  useEffect(() => {
    if (session === undefined) return;
    router.replace(session ? "/my-issues" : "/login");
  }, [session, router]);
  return null;
}

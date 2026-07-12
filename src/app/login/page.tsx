import Link from "next/link";
import { Waves } from "lucide-react";

import { LoginForm } from "@/app/login/login-form";

export const metadata = {
  title: "Sign in",
};

export default function LoginPage() {
  return (
    <main className="grid min-h-screen place-items-center px-6 py-12">
      <div className="w-full max-w-md space-y-7">
        <Link
          href="/"
          className="mx-auto flex w-fit items-center gap-2 font-semibold tracking-tight"
        >
          <span className="grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Waves className="size-5" aria-hidden="true" />
          </span>
          Sailing
        </Link>
        <LoginForm />
      </div>
    </main>
  );
}

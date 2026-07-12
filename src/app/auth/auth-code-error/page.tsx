import Link from "next/link";
import { AlertTriangle } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export default function AuthCodeErrorPage() {
  return (
    <main className="grid min-h-screen place-items-center px-6">
      <div className="w-full max-w-md space-y-5">
        <Alert variant="destructive">
          <AlertTriangle aria-hidden="true" />
          <AlertTitle>We could not complete sign in</AlertTitle>
          <AlertDescription>
            The link may have expired or the authentication provider returned an error.
          </AlertDescription>
        </Alert>
        <Button asChild className="w-full">
          <Link href="/login">Return to sign in</Link>
        </Button>
      </div>
    </main>
  );
}

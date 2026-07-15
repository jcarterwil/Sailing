"use client";

import { useRouter } from "next/navigation";

import { BoatSelect } from "@/components/boats/boat-select";
import type { ViewableBoatOption } from "@/lib/boats/my-sailing";

/** Compact boat switcher that updates ?boat= without storing a preference. */
export function BoatContextSelector({
  boats,
  activeBoatId,
  basePath = "/dashboard",
}: {
  boats: ViewableBoatOption[];
  activeBoatId: string;
  basePath?: string;
}) {
  const router = useRouter();

  if (boats.length === 0) return null;

  return (
    <div className="w-full max-w-xs sm:w-56">
      <BoatSelect
        boats={boats}
        value={activeBoatId}
        ariaLabel="Active boat"
        placeholder="Choose a boat"
        onValueChange={(boatId) => {
          const params = new URLSearchParams();
          params.set("boat", boatId);
          router.push(`${basePath}?${params.toString()}`);
        }}
      />
    </div>
  );
}

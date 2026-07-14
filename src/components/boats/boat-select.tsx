"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ActiveBoatOption } from "@/lib/boats/active-boats";
import { CREATE_NEW_BOAT_VALUE } from "@/lib/boats/fleet-mapping";

function boatDetails(boat: ActiveBoatOption) {
  return [boat.sailNumber ? `#${boat.sailNumber}` : null, boat.boatClass]
    .filter(Boolean)
    .join(" · ");
}

export function BoatSelect({
  boats,
  value,
  onValueChange,
  placeholder = "Choose a boat",
  allowCreate = false,
  createLabel = "Create a new boat",
  ariaLabel = "Boat",
}: {
  boats: ActiveBoatOption[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  allowCreate?: boolean;
  createLabel?: string;
  ariaLabel?: string;
}) {
  return (
    <Select value={value || undefined} onValueChange={onValueChange}>
      <SelectTrigger className="min-h-11 w-full" aria-label={ariaLabel}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent position="popper" className="max-w-[calc(100vw-2rem)]">
        {boats.map((boat) => {
          const details = boatDetails(boat);
          return (
            <SelectItem key={boat.id} value={boat.id} className="min-h-11">
              <span className="min-w-0 truncate">
                {boat.name}
                {details ? ` · ${details}` : ""}
              </span>
            </SelectItem>
          );
        })}
        {allowCreate && boats.length > 0 ? <SelectSeparator /> : null}
        {allowCreate ? (
          <SelectItem value={CREATE_NEW_BOAT_VALUE} className="min-h-11 font-medium">
            {createLabel}
          </SelectItem>
        ) : null}
      </SelectContent>
    </Select>
  );
}

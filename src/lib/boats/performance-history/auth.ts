import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/** Authorize a boat Performance History read (`can_view_boat`; editor not required). */
export async function requireBoatViewer(boatId: string) {
  if (!UUID_PATTERN.test(boatId)) {
    return { error: jsonError("Not allowed.", 403) } as const;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: jsonError("Not signed in.", 401) } as const;
  }

  const { data: canView, error } = await supabase.rpc("can_view_boat", { bid: boatId });
  if (error) {
    return { error: jsonError("Could not verify boat access.", 500) } as const;
  }
  if (!canView) {
    return { error: jsonError("Not allowed.", 403) } as const;
  }

  return { supabase, user } as const;
}

/** Authorize a boat write that may burn external AI tokens (`can_edit_boat`). */
export async function requireBoatEditor(boatId: string) {
  if (!UUID_PATTERN.test(boatId)) {
    return { error: jsonError("Not allowed.", 403) } as const;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: jsonError("Not signed in.", 401) } as const;
  }

  const { data: canEdit, error } = await supabase.rpc("can_edit_boat", { bid: boatId });
  if (error) {
    return { error: jsonError("Could not verify boat access.", 500) } as const;
  }
  if (!canEdit) {
    return { error: jsonError("Not allowed.", 403) } as const;
  }

  return { supabase, user } as const;
}

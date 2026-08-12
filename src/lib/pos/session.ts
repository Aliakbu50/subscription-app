/**
 * Who is the signed-in cashier, and which café and branch do they work for?
 *
 * THIS is where branch comes from. The client never sends a branch id — if it
 * did, anyone could point a redemption at another merchant's branch just by
 * editing a request. Deriving it from the staff record server-side means the
 * tenant boundary is not something the browser gets an opinion about.
 */
import "server-only";
import { createServerClient } from "@/lib/supabase/server";

export type StaffContext = {
  staffUserId: string;
  merchantId: string;
  /** null means the staff member is not tied to one branch. */
  branchId: string | null;
  displayName: string;
  role: "owner" | "manager" | "cashier";
};

/**
 * Returns null when nobody is signed in, or when the signed-in auth user has
 * no active staff_users row. Those are different problems for the person
 * holding the phone, so callers should tell them apart: the first means "sign
 * in", the second means "your account is not linked to a café".
 */
export async function getStaffContext(): Promise<StaffContext | null> {
  const supabase = await createServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("staff_users")
    .select("id, merchant_id, branch_id, display_name, role")
    .eq("auth_user_id", user.id)
    .eq("status", "active")
    .maybeSingle();

  if (error || !data) return null;

  return {
    staffUserId: data.id,
    merchantId: data.merchant_id,
    branchId: data.branch_id,
    displayName: data.display_name,
    role: data.role,
  };
}

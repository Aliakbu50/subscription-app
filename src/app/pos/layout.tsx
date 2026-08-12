import { ConnectionIndicator } from "@/components/pos/ConnectionIndicator";
import { SignOutButton } from "@/components/pos/SignOutButton";
import { getStaffContext } from "@/lib/pos/session";

/**
 * Shell for every cashier screen.
 *
 * The header is deliberately thin — screen space on a phone belongs to the
 * member's name and the confirm button, not to chrome. The one thing that
 * earns permanent space is the connection indicator.
 */
export default async function PosLayout({ children }: LayoutProps<"/pos">) {
  const staff = await getStaffContext();

  return (
    <div className="flex min-h-full flex-col">
      {staff && (
        <header className="flex items-center justify-between border-b border-rule bg-surface px-4 py-3">
          <span className="font-semibold">{staff.displayName}</span>
          <div className="flex items-center gap-4">
            <ConnectionIndicator />
            <SignOutButton />
          </div>
        </header>
      )}
      {children}
    </div>
  );
}

import { forwardRef } from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { usePermissions, type PermissionKey } from "@/hooks/use-permissions";
import { useContactAdminModal } from "@/components/ContactAdminModal";
import { cn } from "@/lib/utils";

type RestrictedButtonProps = ButtonProps & {
  /** Permission key from the backend matrix, e.g. "user.delete" */
  permission: PermissionKey;
};

// ── RestrictedButton ─────────────────────────────────────────────────────
// Drop-in replacement for <Button>. This is the ONE place that implements
// the global rule: never hide a restricted action, always show it
// disabled, and clicking it explains why instead of doing nothing.
//
//   <RestrictedButton permission="user.delete" onClick={handleDelete}>
//     Delete
//   </RestrictedButton>
//
// If the admin doesn't have "user.delete": the button renders disabled
// (opacity + not-allowed cursor, no pointer-events-none — a disabled
// native <button> already ignores clicks, so we handle the "explain why"
// click via a wrapping span instead, see below), and clicking anywhere on
// it opens the shared "Please contact administrator" modal instead of
// calling onClick.
export const RestrictedButton = forwardRef<HTMLButtonElement, RestrictedButtonProps>(
  ({ permission, onClick, className, disabled, children, ...props }, ref) => {
    const { can, loaded } = usePermissions();
    const { open } = useContactAdminModal();

    // While permissions are still loading, don't flash an enabled button
    // that then locks — but also don't punish the user with the modal for
    // a click during that ~one network round trip.
    const permitted = loaded ? can(permission) : true;
    const isDisabled = disabled || !permitted;

    return (
      // A truly-disabled <button> swallows all click events, including
      // ones we'd want to catch to show the modal — so the disabled state
      // is applied visually + via aria, and the click gate happens in the
      // handler instead of relying on the native `disabled` attribute.
      <Button
        ref={ref}
        type="button"
        aria-disabled={isDisabled}
        data-restricted={!permitted || undefined}
        onClick={(e) => {
          if (!permitted) {
            e.preventDefault();
            open();
            return;
          }
          if (disabled) return;
          onClick?.(e);
        }}
        className={cn(
          !permitted && "opacity-50 cursor-not-allowed hover:opacity-50",
          className
        )}
        {...props}
      >
        {children}
      </Button>
    );
  }
);
RestrictedButton.displayName = "RestrictedButton";
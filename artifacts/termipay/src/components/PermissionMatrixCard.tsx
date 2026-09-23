import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ShieldAlert } from "lucide-react";
import { useTheme } from "@/hooks/use-theme";

// ── ContactAdminModal ────────────────────────────────────────────────────
// One shared modal for the whole app, rather than one Dialog instance per
// RestrictedButton. Mount <ContactAdminProvider> once near the app root
// (next to your other providers), and any RestrictedButton anywhere in the
// tree can trigger it via useContactAdminModal().open().
const ContactAdminModalContext = createContext<{ open: () => void } | null>(null);

export function useContactAdminModal() {
  const ctx = useContext(ContactAdminModalContext);
  if (!ctx) {
    throw new Error("useContactAdminModal must be used within <ContactAdminProvider>");
  }
  return ctx;
}

export function ContactAdminProvider({ children }: { children: ReactNode }) {
  const { isDark } = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const open = useCallback(() => setIsOpen(true), []);

  return (
    <ContactAdminModalContext.Provider value={{ open }}>
      {children}
      <AlertDialog open={isOpen} onOpenChange={setIsOpen}>
        <AlertDialogContent className={isDark ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200"}>
          <AlertDialogHeader>
            <AlertDialogTitle className={`font-bold tracking-tight flex items-center gap-2 ${isDark ? "text-white" : "text-slate-900"}`}>
              <ShieldAlert className="text-amber-500" size={18} />
              Restricted Action
            </AlertDialogTitle>
            <AlertDialogDescription className={`text-sm leading-relaxed ${isDark ? "text-slate-400" : "text-slate-500"}`}>
              Please contact administrator
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction
              onClick={() => setIsOpen(false)}
              className="bg-blue-600 text-white hover:bg-blue-700 font-semibold text-xs cursor-pointer"
            >
              Got it
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ContactAdminModalContext.Provider>
  );
}
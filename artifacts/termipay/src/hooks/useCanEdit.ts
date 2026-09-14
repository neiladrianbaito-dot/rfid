import { useAuth } from "@/context/AuthContext";

export function useCanEdit() {
  const { isViewOnly } = useAuth();
  return { canEdit: !isViewOnly };
}
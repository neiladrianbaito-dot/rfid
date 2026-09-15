import { memo } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import type { Transaction } from "@/components/transaction-detail-modal";
import { formatAmount } from "@/lib/dashboard-formatters";
const MobileTxRow = memo(function MobileTxRow({
  tx,
  onClick,
  isDark,
}
export { MobileTxRow };

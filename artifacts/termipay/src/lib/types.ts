export type UserRecord = {
   id: number;     
  cardUid?: string;
  fullName?: string;
  email?: string | null;
  contactNumber?: string;
  type?: string;
  balance: string | number;
  status: string;
  // 🔧 FIX: was missing — this is why "Valid Until" always rendered N/A.
  // The value flows: backend `/paymongo/dashboard` response -> getUserByCardUid()
  // -> useCardData() hook -> this type -> PaymongoDashboardPage's VirtualCard.
  // If any one of those links doesn't carry it, it comes out N/A.
  expirationDate?: string | null;
};

export type TransactionRecord = {
  id: number;
  timestamp: string;
  cardUid?: string;
  type: string;
  amount: string | number;
  status: string;
  route_id?: number | null;
  payment_method?: string | null; // ✅ dagdag ito
};

export type CardValidationState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "found"; cardData: { fullName?: string; cardUid: string; type?: string; status?: string } }
  | { status: "blocked" }
  | { status: "not_found" }
  | { status: "error"; message: string };
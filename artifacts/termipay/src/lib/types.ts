export type UserRecord = {
  cardUid?: string;
  fullName?: string;
  email?: string | null;
  contactNumber?: string;
  type?: string;
  balance: string | number;
  status: string;
};

export type TransactionRecord = {
  id: number;
  timestamp: string;
  cardUid?: string;
  type: string;
  amount: string | number;
  status: string;
   route_id?: number | null; // ✅ idagdag ito
};

export type CardValidationState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "found"; cardData: { fullName?: string; cardUid: string; type?: string; status?: string } }
  | { status: "blocked" }
  | { status: "not_found" }
  | { status: "error"; message: string };

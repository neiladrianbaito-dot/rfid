import { useEffect, useState } from "react";
import { Link } from "wouter";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export default function TopupPage() {
  const [cardUid, setCardUid] = useState<string>("");
  const [amount, setAmount] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const [isAlertOpen, setIsAlertOpen] = useState(false);
  const [alertContent, setAlertContent] = useState({ title: "", msg: "" });

  const showAlert = (title: string, msg: string) => {
    setAlertContent({ title, msg });
    setIsAlertOpen(true);
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const uid = params.get("card_uid");
    if (uid) {
      const cleanUid = uid.replace(/[^a-zA-Z0-9-_]/g, "").toUpperCase();
      setCardUid(cleanUid);
    }
  }, []);

  const handleUidChange = (value: string) => {
    const cleaned = value.replace(/[^a-zA-Z0-9-_]/g, "").toUpperCase();
    setCardUid(cleaned);
  };

  const pay = async () => {
    if (!cardUid || !amount) {
      showAlert("Missing Information", "Please enter both a card UID and an amount.");
      return;
    }

    // Logic: Check if amount is zero
    if (parseFloat(amount) === 0) {
      showAlert("Invalid Amount", "Please enter exact amount.");
      return;
    }

    try {
      setLoading(true);

      // DIRETSO NA SA EDGE FUNCTION
      // Ang Edge Function mo na ang mag-che-check kung valid ang card_uid
      const res = await fetch(
        "https://bpznyktrerwtnpqjrvgz.supabase.co/functions/v1/create-checkout",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ card_uid: cardUid, amount: amount })
        }
      );

      const data = await res.json();

      if (!res.ok) {
        // Kapag nag-status 404 o 400 ang Edge Function (e.g. Invalid Card)
        showAlert(
          data.error || "Validation Error", 
          data.message || "Hindi ma-verify ang iyong card. Subukan muli."
        );
        return;
      }

      if (data.checkout_url) {
        // Redirect to PayMongo Checkout
        window.location.href = data.checkout_url;
      } else {
        showAlert("Server Error", "No checkout URL was returned.");
      }
    } catch (err) {
      console.error(err);
      showAlert("Connection Error", "Hindi makakonekta sa server. Pakisuri ang iyong internet.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
      background: "radial-gradient(circle at top, #0f172a 0%, #020617 55%, #020617 100%)",
      overflow: "hidden"
    }}>
      <style>{`
        @keyframes border-rotate {
          from { transform: rotate(360deg); }
          to { transform: rotate(0deg); }
        }
        .rgb-container {
          position: relative;
          width: min(94vw, 366px);
          height: auto;
          padding: 3px;
          border-radius: 23px;
          overflow: hidden;
          display: flex;
          justify-content: center;
          align-items: center;
          z-index: 0;
        }
        .rgb-container::before {
          content: '';
          position: absolute;
          width: 200%;
          height: 200%;
          background: conic-gradient(
            #ff0000, #ff7300, #fffb00, #48ff00, #00ffd5, #002bff, #7a00ff, #ff00c8, #ff0000
          );
          animation: border-rotate 4s linear infinite;
          z-index: -2;
        }
        .rgb-container::after {
          content: '';
          position: absolute;
          inset: 3px;
          background: rgba(15, 23, 42, 0.95);
          border-radius: 20px;
          z-index: -1;
        }
      `}</style>

      <Dialog open={isAlertOpen} onOpenChange={setIsAlertOpen}>
        <DialogContent className="sm:max-w-[425px] bg-slate-900 text-white border-slate-700">
          <DialogHeader>
            <DialogTitle>{alertContent.title}</DialogTitle>
            <DialogDescription className="text-slate-400">
              {alertContent.msg}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setIsAlertOpen(false)} className="bg-emerald-600 hover:bg-emerald-700">
              Got it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="rgb-container">
        <div style={{
          width: "100%",
          padding: "24px",
          borderRadius: "20px",
          background: "transparent", 
          backdropFilter: "blur(16px)",
          color: "white",
        }}>

          <h2 style={{ marginBottom: "8px", fontSize: "1.5rem", fontWeight: "bold" }}>
            💳 Top-up Wallet
          </h2>

          <p style={{ fontSize: "13px", opacity: 0.8, marginBottom: "24px" }}>
            Scan or enter your card details
          </p>

          <label style={{ fontSize: "12px", fontWeight: "600", color: "#94a3b8", display: "block", marginBottom: "4px" }}>Card UID</label>
          <input
            type="text"
            placeholder="e.g. CARD-001"
            value={cardUid}
            onChange={(e) => handleUidChange(e.target.value)}
            style={{
              width: "100%",
              padding: "12px",
              marginBottom: "16px",
              borderRadius: "10px",
              border: "1px solid rgba(255,255,255,0.1)",
              outline: "none",
              background: "rgba(255,255,255,0.05)",
              color: "white"
            }}
          />

          <label style={{ fontSize: "12px", fontWeight: "600", color: "#94a3b8", display: "block", marginBottom: "4px" }}>Amount</label>
          <input
            type="number"
            placeholder="Enter amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            style={{
              width: "100%",
              padding: "12px",
              marginBottom: "24px",
              borderRadius: "10px",
              border: "1px solid rgba(255,255,255,0.1)",
              outline: "none",
              background: "rgba(255,255,255,0.05)",
              color: "white"
            }}
          />

          <button
            onClick={pay}
            disabled={loading}
            style={{
              width: "100%",
              padding: "14px",
              borderRadius: "10px",
              border: "none",
              background: loading ? "#475569" : "#22c55e",
              color: "white",
              fontWeight: "700",
              fontSize: "15px",
              cursor: "pointer",
              transition: "all 0.2s ease"
            }}
          >
            {loading ? "Verifying Card..." : "Pay via GCash"}
          </button>

          <div style={{ marginTop: "12px", textAlign: "center" }}>
            <Link
              href={`/paymongo-dashboard${cardUid ? `?card_uid=${encodeURIComponent(cardUid)}` : ""}`}
              className="text-xs text-blue-300 hover:text-blue-200 underline underline-offset-4"
            >
              Check balance and real-time logs
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
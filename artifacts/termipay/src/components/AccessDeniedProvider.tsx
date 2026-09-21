import { useEffect, useState, type ReactNode } from "react";
import { registerAccessDeniedHandler, type ApiErrorCode } from "../lib/api-client";

/**
 * Mount this ONCE, high up in your app tree (e.g. inside your admin layout
 * or in App.tsx wrapping the router):
 *
 *   <AccessDeniedProvider>
 *     <RouterProvider router={router} />
 *   </AccessDeniedProvider>
 *
 * Any 403 from apiFetch() with code VIEW_ONLY / SUPER_ADMIN_ONLY will pop
 * this modal automatically — no per-page wiring needed.
 */
export function AccessDeniedProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [code, setCode] = useState<ApiErrorCode>("VIEW_ONLY");

  useEffect(() => {
    registerAccessDeniedHandler((msg, c) => {
      setMessage(msg);
      setCode(c);
      setOpen(true);
    });
  }, []);

  const title = code === "SUPER_ADMIN_ONLY" ? "Super Admin Only" : "View Only Access";

  return (
    <>
      {children}

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="access-denied-title"
          onClick={() => setOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(15, 23, 42, 0.55)",
            backdropFilter: "blur(2px)",
            padding: "1rem",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: "26rem",
              background: "#fff",
              borderRadius: "0.9rem",
              boxShadow: "0 20px 45px rgba(0,0,0,0.25)",
              padding: "1.5rem",
              fontFamily: "inherit",
            }}
          >
            <div
              style={{
                width: "2.75rem",
                height: "2.75rem",
                borderRadius: "999px",
                background: "#FEF3C7",
                color: "#B45309",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "1.35rem",
                marginBottom: "0.9rem",
              }}
            >
              ⚠
            </div>

            <h2
              id="access-denied-title"
              style={{ margin: 0, fontSize: "1.05rem", fontWeight: 700, color: "#0F172A" }}
            >
              {title}
            </h2>

            <p
              style={{
                margin: "0.5rem 0 1.25rem",
                fontSize: "0.9rem",
                lineHeight: 1.55,
                color: "#475569",
              }}
            >
              {message}
            </p>

            <button
              type="button"
              onClick={() => setOpen(false)}
              style={{
                width: "100%",
                padding: "0.65rem 1rem",
                borderRadius: "0.6rem",
                border: "none",
                background: "#0F172A",
                color: "#fff",
                fontWeight: 600,
                fontSize: "0.9rem",
                cursor: "pointer",
              }}
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export default AccessDeniedProvider;
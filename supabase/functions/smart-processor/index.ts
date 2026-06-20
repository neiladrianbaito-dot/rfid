import { createClient } from "https://esm.sh/@supabase/supabase-js"

// Supabase admin client
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
)

Deno.serve(async (req) => {
  try {
    const body = await req.json()

    // 🔥 PayMongo webhook structure
    const session = body.data?.attributes

    const payment = session?.payments?.[0]?.attributes

    const paymentIntent = session?.payment_intent?.attributes

    // 🔑 GET card_uid from metadata
    const card_uid =
      payment?.metadata?.card_uid ||
      paymentIntent?.metadata?.card_uid

    // 💰 GET AMOUNT (convert centavos → PHP)
    const amount =
      (payment?.amount || paymentIntent?.amount || 0) / 100

    // 📌 STATUS CHECK
    const status =
      payment?.status ||
      paymentIntent?.status ||
      session?.status

    // ❌ validation
    if (!card_uid || !amount) {
      console.log("Missing data:", { card_uid, amount })
      return new Response("Missing data", { status: 400 })
    }

    // ❌ only process successful payments
    if (status !== "paid" && status !== "succeeded") {
      console.log("Payment not completed:", status)
      return new Response("Not paid", { status: 200 })
    }

    // 🔎 find user by RFID card_uid
    const { data: user, error } = await supabase
      .from("users")
      .select("gcash_loaded_total")
      .eq("card_uid", card_uid)
      .single()

    if (error || !user) {
      console.log("User not found:", error)
      return new Response("User not found", { status: 404 })
    }

    // 💰 compute new balance
    const newBalance =
      Number(user.gcash_loaded_total || 0) + Number(amount)

    // 🔄 update balance
    const { error: updateError } = await supabase
      .from("users")
      .update({
        gcash_loaded_total: newBalance,
      })
      .eq("card_uid", card_uid)

    if (updateError) {
      console.log("Update error:", updateError)
      return new Response("Update failed", { status: 500 })
    }

    console.log("SUCCESS LOAD:", {
      card_uid,
      added: amount,
      newBalance,
    })

    return new Response(
      JSON.stringify({
        success: true,
        card_uid,
        added: amount,
        newBalance,
      }),
      {
        headers: { "Content-Type": "application/json" },
      }
    )

  } catch (err) {
    console.log("Webhook error:", err)
    return new Response(err.message, { status: 500 })
  }
})
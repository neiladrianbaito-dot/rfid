import { createClient } from "https://esm.sh/@supabase/supabase-js"

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
)

Deno.serve(async (req) => {
  try {
    const payload = await req.json();
    const eventType = payload?.data?.attributes?.type;

    console.log(`Event Received: ${eventType}`);

    if (eventType === "checkout_session.payment.paid") {
      const resourceData = payload.data.attributes.data.attributes;
      const { card_uid, amount } = resourceData.metadata;

      // Siguraduhin na number ang format ng amount
      const topUpAmount = Number(amount);
      console.log(`Target Card: ${card_uid} | Top-up: ₱${topUpAmount}`);

      // 1. FETCH: Kunin ang kasalukuyang data ng user mula sa 'users' table
      const { data, error: fetchError } = await supabase
        .from('users') 
        .select('gcash_loaded_total, balance')
        .eq('card_uid', card_uid)
        .single();

      if (fetchError || !data) {
        console.error("User/Card not found in 'users' table:", fetchError?.message);
        // Nagbabalik pa rin tayo ng 200 para hindi mag-retry nang mag-retry ang PayMongo
        return new Response("User not found", { status: 200 });
      }

      // 2. COMPUTATION: Tamang math para sa total_wallet
      const currentGcashTotal = Number(data.gcash_loaded_total || 0);
      const currentBalance = Number(data.balance || 0);

      const newGcashTotal = currentGcashTotal + topUpAmount;
      const newTotalWallet = currentBalance + newGcashTotal;

      // 3. UPDATE: I-update ang gcash_loaded_total at total_wallet nang sabay
      const { error: updateError } = await supabase
        .from('users')
        .update({ 
          gcash_loaded_total: newGcashTotal,
          total_wallet: newTotalWallet 
        })
        .eq('card_uid', card_uid);

      if (updateError) {
        console.error("Update Failed:", updateError.message);
      } else {
        console.log(`✅ Success: Updated for ${card_uid}. New Total Wallet: ₱${newTotalWallet}`);

        // 4. TRANSACTION LOGIC: I-insert ang record sa 'transactions' table
        // HINDI natin isasama ang 'id' dito dahil automatic na ito sa database (Identity)
        const { error: logError } = await supabase
          .from('transactions')
          .insert([
            {
              card_uid: card_uid,
              type: 'Top-up',
              amount: topUpAmount,
              status: 'Success'
              // Ang 'timestamp' at 'id' ay automatic nang lalabas base sa database settings
            }
          ]);

        if (logError) {
          console.error("📝 Transaction Log Error:", logError.message);
        } else {
          console.log("📝 Transaction log saved successfully!");
        }
      }
    }

    // Always return 200 to PayMongo para hindi mag-error ang kanilang webhook delivery
    return new Response(JSON.stringify({ status: "success" }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });

  } catch (err) {
    console.error("Webhook Crash:", err.message);
    // Return 200 kahit may error sa logic para sa webhook safety
    return new Response("Error Handled", { status: 200 });
  }
})
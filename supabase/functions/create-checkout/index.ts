import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const PAYMONGO_SECRET_KEY = Deno.env.get('PAYMONGO_SECRET_KEY');

serve(async (req) => {
  // 1. CORS Headers para hindi ma-block
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers });
  }

  try {
    // 2. Basahin ang JSON mula sa Postman
    const { card_uid, amount } = await req.json();

    if (!card_uid || !amount) {
      return new Response(JSON.stringify({ error: "Missing card_uid or amount sa Postman body" }), { status: 400, headers });
    }

    // 3. Tawagan ang PayMongo
    const response = await fetch("https://api.paymongo.com/v1/checkout_sessions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Importante: Ang btoa ay dapat may ":" sa dulo para sa Basic Auth
        Authorization: `Basic ${btoa(PAYMONGO_SECRET_KEY + ":")}`,
      },
      body: JSON.stringify({
        data: {
          attributes: {
            payment_method_types: ["gcash", "paymaya"],
            line_items: [{
              name: `Top-up para sa ${card_uid}`,
              amount: Math.round(Number(amount) * 100), // Convert to cents
              currency: "PHP",
              quantity: 1,
            }],
            // Dito naka-embed ang metadata para sa webhook mo
            metadata: { card_uid: card_uid }
          },
        },
      }),
    });

    const session = await response.json();

    // 4. CHECK KUNG MAY ERROR GALING KAY PAYMONGO
    if (session.errors) {
      return new Response(JSON.stringify({ 
        error: "PayMongo API Error", 
        details: session.errors 
      }), { status: 400, headers });
    }

    // 5. Pag successful, ibalik ang checkout_url sa Postman
    return new Response(JSON.stringify({ 
      message: "Success! Copy the URL below to create your QR Code",
      card_uid: card_uid,
      checkout_url: session.data.attributes.checkout_url 
    }), { status: 200, headers });

  } catch (err) {
    return new Response(JSON.stringify({ 
      error: "Server Error", 
      message: err.message 
    }), { status: 500, headers });
  }
});
// Test endpoint to verify hooks are working
routerAdd("GET", "/api/test", (c) => {
    return c.json(200, {
        message: "Hooks are working!",
        version: "1.0.0"
    })
})

// Real Stripe checkout endpoint
routerAdd("POST", "/api/stripe/create-checkout-session", async (c) => {
    console.log("=== Creating real Stripe checkout session ===")

    try {
        const data = $apis.requestInfo(c).data
        const authRecord = $apis.requestInfo(c).authRecord

        console.log("Auth record:", authRecord ? authRecord.email() : "none")
        console.log("Plan ID:", data.planId)

        if (!authRecord) {
            console.log("No auth record found")
            throw new BadRequestError("Authentication required")
        }

        // Get the subscription plan
        const plan = $app.dao().findRecordById("subscription_plans", data.planId)
        if (!plan) {
            console.log("Plan not found:", data.planId)
            throw new BadRequestError("Invalid plan ID")
        }

        console.log("Plan found:", plan.get("name"), "Price ID:", plan.get("stripe_price_id"))

        // Get Stripe secret key from environment
        const stripeSecretKey = process.env.STRIPE_SECRET_KEY
        if (!stripeSecretKey) {
            console.log("Stripe secret key not found in environment")
            throw new BadRequestError("Stripe not configured")
        }

        console.log("Creating Stripe session...")
        const stripe = require('stripe')(stripeSecretKey)

        const session = await stripe.checkout.sessions.create({
            customer_email: authRecord.email(),
            line_items: [{
                price: plan.get("stripe_price_id"),
                quantity: 1,
            }],
            mode: 'subscription',
            success_url: data.successUrl + '?session_id={CHECKOUT_SESSION_ID}&success=true',
            cancel_url: data.cancelUrl + '?canceled=true',
            metadata: {
                user_id: authRecord.id,
                plan_id: data.planId,
                plan_name: plan.get("name")
            }
        })

        console.log("Stripe session created successfully:", session.id)
        console.log("Redirect URL:", session.url)

        return c.json(200, {
            sessionId: session.id,
            url: session.url
        })

    } catch (error) {
        console.log("Error creating Stripe session:", error.message)
        throw new BadRequestError("Failed to create checkout session: " + error.message)
    }
})
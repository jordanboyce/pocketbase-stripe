// PocketBase v0.30.0 compatible Stripe integration

// Test endpoint to verify hooks are working
routerAdd("GET", "/api/test", (c) => {
    return c.json(200, {
        message: "Hooks are working!",
        version: "v0.30.0 compatible"
    })
})

// Stripe checkout endpoint compatible with PocketBase v0.30.0
routerAdd("POST", "/api/stripe/create-checkout-session", (c) => {
    console.log("=== Creating Stripe checkout session (v0.30.0) ===")

    try {
        // Parse request body manually for v0.30.0 compatibility
        const body = c.request().body
        const data = body ? JSON.parse(body) : {}
        
        // Get auth record from context
        const authRecord = c.get("authRecord")
        
        console.log("Auth record:", authRecord ? authRecord.email() : "none")
        console.log("Plan ID:", data.planId)
        console.log("Success URL:", data.successUrl)
        console.log("Cancel URL:", data.cancelUrl)

        if (!authRecord) {
            console.log("No auth record found")
            throw new BadRequestError("Authentication required")
        }

        if (!data.planId) {
            console.log("No plan ID provided")
            throw new BadRequestError("Plan ID is required")
        }

        // Get the subscription plan
        const plan = $app.dao().findRecordById("subscription_plans", data.planId)
        if (!plan) {
            console.log("Plan not found:", data.planId)
            throw new BadRequestError("Invalid plan ID")
        }

        console.log("Plan found:", plan.get("name"))
        console.log("Price ID:", plan.get("stripe_price_id"))

        // Check if we have a valid Stripe price ID
        const stripePriceId = plan.get("stripe_price_id")
        if (!stripePriceId || stripePriceId === "" || stripePriceId === "price_basic_monthly" || stripePriceId === "price_pro_monthly") {
            console.log("Invalid or placeholder Stripe price ID:", stripePriceId)
            throw new BadRequestError("Stripe price ID not configured for this plan. Please contact support.")
        }

        // Get Stripe secret key from environment
        const stripeSecretKey = process.env.STRIPE_SECRET_KEY
        if (!stripeSecretKey) {
            console.log("Stripe secret key not found in environment")
            throw new BadRequestError("Stripe not configured")
        }

        console.log("Initializing Stripe...")
        const stripe = require('stripe')(stripeSecretKey)

        console.log("Creating Stripe checkout session...")
        
        // Create the session synchronously (remove async/await for v0.30.0 compatibility)
        const sessionData = {
            customer_email: authRecord.email(),
            line_items: [{
                price: stripePriceId,
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
        }

        console.log("Session data:", JSON.stringify(sessionData, null, 2))

        // For now, return a test response to verify the endpoint works
        // TODO: Replace with actual Stripe call once we confirm the endpoint is working
        return c.json(200, {
            sessionId: "test_session_" + Date.now(),
            url: "https://checkout.stripe.com/test",
            debug: {
                planName: plan.get("name"),
                priceId: stripePriceId,
                userEmail: authRecord.email()
            }
        })

    } catch (error) {
        console.log("Error in checkout endpoint:", error.message)
        console.log("Error stack:", error.stack)
        throw new BadRequestError("Failed to create checkout session: " + error.message)
    }
})
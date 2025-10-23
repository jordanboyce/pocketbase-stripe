// Test endpoint to verify hooks are working
routerAdd("GET", "/api/test", (c) => {
    return c.json(200, {
        message: "Hooks are working!",
        version: "1.0.0"
    })
})

// Simple Stripe checkout endpoint (no async for now)
routerAdd("POST", "/api/stripe/create-checkout-session", (c) => {
    console.log("=== Creating Stripe checkout session ===")

    const info = $apis.requestInfo(c)
    
    console.log("Auth record:", info.authRecord ? info.authRecord.email() : "none")
    console.log("Plan ID:", info.data.planId)

    if (!info.authRecord) {
        console.log("No auth record found")
        throw new BadRequestError("Authentication required")
    }

    if (!info.data.planId) {
        console.log("No plan ID provided")
        throw new BadRequestError("Plan ID is required")
    }

    // Get the subscription plan
    const plan = $app.dao().findRecordById("subscription_plans", info.data.planId)
    if (!plan) {
        console.log("Plan not found:", info.data.planId)
        throw new BadRequestError("Invalid plan ID")
    }

    console.log("Plan found:", plan.get("name"), "Price ID:", plan.get("stripe_price_id"))

    // For now, return test data to verify the endpoint works
    return c.json(200, {
        message: "Checkout endpoint working",
        sessionId: "test_session_" + Date.now(),
        url: "https://checkout.stripe.com/test",
        debug: {
            planName: plan.get("name"),
            priceId: plan.get("stripe_price_id"),
            userEmail: info.authRecord.email(),
            planId: info.data.planId,
            successUrl: info.data.successUrl,
            cancelUrl: info.data.cancelUrl
        }
    })
})
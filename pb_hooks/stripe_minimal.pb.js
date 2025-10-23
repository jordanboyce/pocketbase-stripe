// Test endpoint to verify hooks are working
routerAdd("GET", "/api/test", (c) => {
    return c.json(200, {
        message: "Hooks are working!",
        version: "1.0.0"
    })
})

// Simple Stripe checkout endpoint using basic PocketBase v0.30.0 API
routerAdd("POST", "/api/stripe/create-checkout-session", (c) => {
    console.log("=== Creating Stripe checkout session ===")

    try {
        // Get request body directly
        const body = c.request().body
        console.log("Raw body:", body)

        let data = {}
        if (body) {
            try {
                data = JSON.parse(body)
            } catch (e) {
                console.log("Failed to parse body:", e.message)
                data = {}
            }
        }

        console.log("Parsed data:", JSON.stringify(data))

        // Try to get auth record from different possible locations
        let authRecord = null
        try {
            authRecord = c.get("authRecord")
        } catch (e) {
            console.log("Could not get authRecord from c.get():", e.message)
        }

        console.log("Auth record:", authRecord ? authRecord.email() : "none")
        console.log("Plan ID:", data.planId)

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

        console.log("Plan found:", plan.get("name"), "Price ID:", plan.get("stripe_price_id"))

        // Return test data to verify the endpoint works
        return c.json(200, {
            message: "Checkout endpoint working",
            sessionId: "test_session_" + Date.now(),
            url: "https://checkout.stripe.com/test",
            debug: {
                planName: plan.get("name"),
                priceId: plan.get("stripe_price_id"),
                userEmail: authRecord.email(),
                planId: data.planId,
                successUrl: data.successUrl,
                cancelUrl: data.cancelUrl
            }
        })

    } catch (error) {
        console.log("Error in checkout endpoint:", error.message)
        throw new BadRequestError("Failed to create checkout session: " + error.message)
    }
})
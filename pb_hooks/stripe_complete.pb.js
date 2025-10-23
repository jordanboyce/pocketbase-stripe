// Complete Stripe integration for Railway PocketBase
// Handles checkout sessions, customer portal, and webhooks

// Create Stripe checkout session
routerAdd("POST", "/api/stripe/create-checkout-session", async (c) => {
    console.log("Creating Stripe checkout session...")
    const data = $apis.requestInfo(c).data
    
    // Validate user authentication
    const authRecord = $apis.requestInfo(c).authRecord
    if (!authRecord) {
        console.log("Authentication failed - no auth record")
        throw new BadRequestError("Authentication required")
    }
    
    console.log("User authenticated:", authRecord.email())
    
    // Get the subscription plan
    const plan = $app.dao().findRecordById("subscription_plans", data.planId)
    if (!plan) {
        throw new BadRequestError("Invalid plan ID")
    }
    
    console.log("Plan found:", plan.get("name"), "Price ID:", plan.get("stripe_price_id"))
    
    // Create Stripe checkout session
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY
    if (!stripeSecretKey) {
        throw new BadRequestError("Stripe secret key not configured")
    }
    
    const stripe = require('stripe')(stripeSecretKey)
    
    try {
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
        
        console.log("Stripe session created:", session.id)
        
        return c.json(200, {
            sessionId: session.id,
            url: session.url
        })
    } catch (error) {
        console.error('Stripe error:', error)
        throw new BadRequestError("Failed to create checkout session: " + error.message)
    }
})

// Create Stripe customer portal session
routerAdd("POST", "/api/stripe/create-portal-session", async (c) => {
    const data = $apis.requestInfo(c).data
    
    // Validate user authentication
    const authRecord = $apis.requestInfo(c).authRecord
    if (!authRecord) {
        throw new BadRequestError("Authentication required")
    }
    
    const stripeCustomerId = authRecord.get("stripe_customer_id")
    if (!stripeCustomerId) {
        throw new BadRequestError("No Stripe customer ID found. Please complete a purchase first.")
    }
    
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY
    if (!stripeSecretKey) {
        throw new BadRequestError("Stripe secret key not configured")
    }
    
    const stripe = require('stripe')(stripeSecretKey)
    
    try {
        const session = await stripe.billingPortal.sessions.create({
            customer: stripeCustomerId,
            return_url: data.returnUrl,
        })
        
        return c.json(200, {
            url: session.url
        })
    } catch (error) {
        console.error('Stripe portal error:', error)
        throw new BadRequestError("Failed to create portal session: " + error.message)
    }
})

// Handle Stripe webhooks
routerAdd("POST", "/api/stripe/webhook", (c) => {
    console.log("Received Stripe webhook")
    
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET
    
    if (!stripeSecretKey || !endpointSecret) {
        console.error("Missing Stripe configuration")
        throw new BadRequestError("Stripe not properly configured")
    }
    
    const stripe = require('stripe')(stripeSecretKey)
    const sig = c.request().header.get('stripe-signature')
    const body = $apis.requestInfo(c).rawBody
    
    let event
    
    try {
        event = stripe.webhooks.constructEvent(body, sig, endpointSecret)
        console.log("Webhook verified:", event.type)
    } catch (err) {
        console.log(`Webhook signature verification failed:`, err.message)
        throw new BadRequestError("Invalid signature")
    }
    
    // Handle the event
    try {
        switch (event.type) {
            case 'checkout.session.completed':
                handleCheckoutCompleted(event.data.object)
                break
            case 'customer.subscription.updated':
                handleSubscriptionUpdated(event.data.object)
                break
            case 'customer.subscription.deleted':
                handleSubscriptionDeleted(event.data.object)
                break
            case 'invoice.payment_succeeded':
                handlePaymentSucceeded(event.data.object)
                break
            case 'invoice.payment_failed':
                handlePaymentFailed(event.data.object)
                break
            default:
                console.log(`Unhandled event type: ${event.type}`)
        }
    } catch (error) {
        console.error("Error processing webhook:", error)
        // Don't throw error - return 200 to prevent Stripe retries
    }
    
    return c.json(200, { received: true })
})

// Webhook event handlers
function handleCheckoutCompleted(session) {
    console.log("Processing checkout completed for session:", session.id)
    
    const userId = session.metadata.user_id
    const planId = session.metadata.plan_id
    
    if (!userId || !planId) {
        console.error("Missing metadata in checkout session")
        return
    }
    
    try {
        // Get the plan details
        const plan = $app.dao().findRecordById("subscription_plans", planId)
        if (!plan) {
            console.error("Plan not found:", planId)
            return
        }
        
        // Update user subscription
        const user = $app.dao().findRecordById("users", userId)
        if (!user) {
            console.error("User not found:", userId)
            return
        }
        
        user.set("subscription_tier", plan.get("name").toLowerCase())
        user.set("subscription_status", "active")
        user.set("stripe_customer_id", session.customer)
        user.set("stripe_subscription_id", session.subscription)
        user.set("usage_limit", plan.get("usage_limit"))
        user.set("usage_count", 0) // Reset usage count
        user.set("billing_period_start", new Date().toISOString())
        
        // Calculate billing period end (30 days from now)
        const billingEnd = new Date()
        billingEnd.setDate(billingEnd.getDate() + 30)
        user.set("billing_period_end", billingEnd.toISOString())
        user.set("last_usage_reset", new Date().toISOString())
        
        $app.dao().saveRecord(user)
        console.log("User subscription updated successfully:", user.email())
        
    } catch (error) {
        console.error("Error updating user subscription:", error)
    }
}

function handleSubscriptionUpdated(subscription) {
    console.log("Processing subscription updated:", subscription.id)
    
    try {
        // Find user by stripe customer ID
        const users = $app.dao().findRecordsByExpr("users", 
            $dbx.exp("stripe_customer_id = {:customer_id}", {
                "customer_id": subscription.customer
            })
        )
        
        if (users.length > 0) {
            const user = users[0]
            user.set("subscription_status", subscription.status)
            user.set("stripe_subscription_id", subscription.id)
            
            // Update billing period
            user.set("billing_period_start", new Date(subscription.current_period_start * 1000).toISOString())
            user.set("billing_period_end", new Date(subscription.current_period_end * 1000).toISOString())
            
            $app.dao().saveRecord(user)
            console.log("Subscription updated for user:", user.email())
        } else {
            console.log("No user found for customer:", subscription.customer)
        }
    } catch (error) {
        console.error("Error updating subscription:", error)
    }
}

function handleSubscriptionDeleted(subscription) {
    console.log("Processing subscription deleted:", subscription.id)
    
    try {
        // Find user by stripe customer ID
        const users = $app.dao().findRecordsByExpr("users", 
            $dbx.exp("stripe_customer_id = {:customer_id}", {
                "customer_id": subscription.customer
            })
        )
        
        if (users.length > 0) {
            const user = users[0]
            user.set("subscription_tier", "free")
            user.set("subscription_status", "canceled")
            user.set("usage_limit", 15) // Free tier limit
            
            $app.dao().saveRecord(user)
            console.log("Subscription canceled for user:", user.email())
        } else {
            console.log("No user found for customer:", subscription.customer)
        }
    } catch (error) {
        console.error("Error canceling subscription:", error)
    }
}

function handlePaymentSucceeded(invoice) {
    console.log("Processing payment succeeded for invoice:", invoice.id)
    
    try {
        // Reset usage count on successful payment (monthly billing cycle)
        const users = $app.dao().findRecordsByExpr("users", 
            $dbx.exp("stripe_customer_id = {:customer_id}", {
                "customer_id": invoice.customer
            })
        )
        
        if (users.length > 0) {
            const user = users[0]
            user.set("usage_count", 0)
            user.set("last_usage_reset", new Date().toISOString())
            
            $app.dao().saveRecord(user)
            console.log("Usage reset for user:", user.email())
        } else {
            console.log("No user found for customer:", invoice.customer)
        }
    } catch (error) {
        console.error("Error resetting usage:", error)
    }
}

function handlePaymentFailed(invoice) {
    console.log("Processing payment failed for invoice:", invoice.id)
    
    try {
        // Update subscription status to past_due
        const users = $app.dao().findRecordsByExpr("users", 
            $dbx.exp("stripe_customer_id = {:customer_id}", {
                "customer_id": invoice.customer
            })
        )
        
        if (users.length > 0) {
            const user = users[0]
            user.set("subscription_status", "past_due")
            
            $app.dao().saveRecord(user)
            console.log("Subscription marked past_due for user:", user.email())
        } else {
            console.log("No user found for customer:", invoice.customer)
        }
    } catch (error) {
        console.error("Error updating payment failed status:", error)
    }
}
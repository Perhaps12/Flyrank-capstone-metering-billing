import request from "supertest";
import app from "../../src/app";
import { findTenantByApiKey } from "../../src/database/queries/tenants";
import { getSubscriptionForTenant } from "../../src/database/queries/subscriptions";
import { createCheckoutSession, verifyStripeSignature } from "../../src/services/stripe";
import { handleWebhookEvent } from "../../src/domain/billing";

beforeEach(() => {
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

jest.mock("../../src/database/queries/tenants", () => ({
  findTenantByApiKey: jest.fn(),
}));

jest.mock("../../src/database/queries/subscriptions", () => ({
  getSubscriptionForTenant: jest.fn(),
}));

jest.mock("../../src/services/stripe", () => ({
  createCheckoutSession: jest.fn(),
  verifyStripeSignature: jest.fn(),
}));

jest.mock("../../src/domain/billing", () => ({
  handleWebhookEvent: jest.fn(),
}));

const mockedFindTenantByApiKey = jest.mocked(findTenantByApiKey);
const mockedGetSubscriptionForTenant = jest.mocked(getSubscriptionForTenant);
const mockedCreateCheckoutSession = jest.mocked(createCheckoutSession);
const mockedVerifyStripeSignature = jest.mocked(verifyStripeSignature);
const mockedHandleWebhookEvent = jest.mocked(handleWebhookEvent);

const webhookEvent = {
  id: "evt_checkout_123",
  type: "checkout.session.completed",
  data: { object: { client_reference_id: "7" } },
};

beforeEach(() => {
  jest.clearAllMocks();
  process.env.STRIPE_PRICE_ID_PRO = "price_test_pro";
  process.env.APP_BASE_URL = "http://localhost:3000";
  mockedFindTenantByApiKey.mockResolvedValue({
    id: 7,
    publicId: "tenant-7",
    apiKey: "test-key",
    name: "Test Tenant",
    createdAt: "2026-08-26T12:00:00.000Z",
  });
});

describe("POST /billing/checkout", () => {
  test("requires authentication", async () => {
    const response = await request(app).post("/billing/checkout");

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      error: "Missing or malformed Authorization header",
    });
  });

  test("creates a checkout session for the authenticated tenant", async () => {
    mockedGetSubscriptionForTenant.mockResolvedValue({
      id: 10,
      tenantId: 7,
      planId: 1,
      stripeCustomerId: "cus_existing",
      stripeSubscriptionId: null,
      status: "canceled",
      updatedAt: "2026-08-26T12:00:00.000Z",
    });
    mockedCreateCheckoutSession.mockResolvedValue({
      id: "cs_test_123",
      url: "https://checkout.stripe.com/test-session",
    } as never);

    const response = await request(app)
      .post("/billing/checkout")
      .set("Authorization", "Bearer test-key");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      checkoutUrl: "https://checkout.stripe.com/test-session",
    });
    expect(mockedCreateCheckoutSession).toHaveBeenCalledWith({
      tenantId: 7,
      priceId: "price_test_pro",
      customerId: "cus_existing",
      successUrl:
        "http://localhost:3000/billing/success?session_id={CHECKOUT_SESSION_ID}",
      cancelUrl: "http://localhost:3000/billing/cancel",
    });
  });

  test("returns 500 when Stripe does not return a checkout URL", async () => {
    mockedGetSubscriptionForTenant.mockResolvedValue(null);
    mockedCreateCheckoutSession.mockResolvedValue({
      id: "cs_test_123",
      url: null,
    } as never);

    const response = await request(app)
      .post("/billing/checkout")
      .set("Authorization", "Bearer test-key");

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: "Could not start checkout" });
  });
});

describe("GET /billing success and cancel", () => {
  test("shows the checkout session on the public success page", async () => {
    const response = await request(app).get(
      "/billing/success?session_id=cs_test_123"
    );

    expect(response.status).toBe(200);
    expect(response.text).toContain("Checkout session: cs_test_123");
  });

  test("serves the public cancellation page", async () => {
    const response = await request(app).get("/billing/cancel");

    expect(response.status).toBe(200);
    expect(response.text).toContain("Checkout canceled");
  });
});

describe("POST /webhooks/stripe", () => {
  test("rejects requests without a Stripe signature", async () => {
    const response = await request(app)
      .post("/webhooks/stripe")
      .set("Content-Type", "application/json")
      .send(JSON.stringify(webhookEvent));

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: "Missing Stripe-Signature header",
    });
    expect(mockedVerifyStripeSignature).not.toHaveBeenCalled();
  });

  test("rejects an invalid Stripe signature", async () => {
    mockedVerifyStripeSignature.mockImplementation(() => {
      throw new Error("No signatures found matching the expected signature");
    });

    const response = await request(app)
      .post("/webhooks/stripe")
      .set("Content-Type", "application/json")
      .set("Stripe-Signature", "bad-signature")
      .send(JSON.stringify(webhookEvent));

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: "Invalid Stripe webhook signature",
    });
    expect(mockedHandleWebhookEvent).not.toHaveBeenCalled();
  });

  test("processes a verified webhook event", async () => {
    mockedVerifyStripeSignature.mockReturnValue(webhookEvent as never);
    mockedHandleWebhookEvent.mockResolvedValue({
      status: "processed",
      tenantId: 7,
      newPlan: "pro",
    });

    const response = await request(app)
      .post("/webhooks/stripe")
      .set("Content-Type", "application/json")
      .set("Stripe-Signature", "valid-signature")
      .send(JSON.stringify(webhookEvent));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      received: true,
      eventId: "evt_checkout_123",
      eventType: "checkout.session.completed",
      status: "processed",
      tenantId: 7,
      newPlan: "pro",
    });
    expect(mockedVerifyStripeSignature).toHaveBeenCalledWith(
      expect.any(Buffer),
      "valid-signature"
    );
    expect(mockedHandleWebhookEvent).toHaveBeenCalledWith(webhookEvent);
  });

  test("returns 500 when webhook processing fails", async () => {
    mockedVerifyStripeSignature.mockReturnValue(webhookEvent as never);
    mockedHandleWebhookEvent.mockRejectedValue(new Error("database unavailable"));

    const response = await request(app)
      .post("/webhooks/stripe")
      .set("Content-Type", "application/json")
      .set("Stripe-Signature", "valid-signature")
      .send(JSON.stringify(webhookEvent));

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: "Webhook processing failed" });
  });
});

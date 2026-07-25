/**
 * --------------------------------------------------------------------
 * File:
 * paymentGateway/providers/razorpay.ts
 *
 * Purpose:
 * Handles all communication with Razorpay.
 *
 * Responsibilities:
 * ✅ Verify API credentials
 * ✅ Create payment orders
 * ✅ Refund payments (later)
 * ✅ Verify webhooks (later)
 *
 * Why?
 * PaymentGatewayService should not know how Razorpay works.
 * This file isolates all Razorpay-specific logic.
 * --------------------------------------------------------------------
 */

import Razorpay from "razorpay";

export interface CreateOrderParams {

    /** Whole rupees — converted to paise here, not by the caller. */
    amountInRupees: number;

    /** Must be unique per order attempt (Razorpay dedupes on this within a short window). */
    receipt: string;

    /**
     * Arbitrary metadata echoed back on the order/payment object —
     * used to carry schoolId/studentId/invoiceId/termId through to
     * whatever verifies the payment later, so that step doesn't have
     * to trust anything the client sends back unchecked.
     */
    notes: Record<string, string>;

}

export interface CreatedOrder {
    id: string;
    amount: number;
    currency: string;
    receipt: string;
    status: string;
}

export class RazorpayProvider {

    /**
     * Verifies whether the supplied Key ID and Key Secret
     * are valid by making a simple API request.
     *
     * Throws an error if authentication fails.
     */
    async verifyCredentials(
        keyId: string,
        keySecret: string
    ): Promise<void> {

        const razorpay = new Razorpay({

            key_id: keyId,

            key_secret: keySecret

        });

        try {

            /**
             * Fetch a single order.
             *
             * We don't care whether an order exists.
             * We only care whether Razorpay accepts
             * the supplied credentials.
             */
            await razorpay.orders.all({
                count: 1
            });

        } catch (error) {

            throw new Error(
                "Invalid Razorpay credentials."
            );

        }

    }

    /**
     * Creates a Razorpay order for one school's own account (keyId/
     * keySecret passed in by the caller, fetched per-school from
     * Secret Manager — this method doesn't know or care which school,
     * same separation of concerns as verifyCredentials above).
     *
     * Amount is converted from whole rupees to paise HERE, once, so
     * every caller works in the same rupee units the rest of this app
     * already uses (see recordPayment.ts's own comment on this) rather
     * than each call site remembering to multiply by 100 itself.
     *
     * payment_capture: 1 — auto-capture on successful authorization.
     * Without this, a successful payment sits "authorized" but
     * uncaptured and must be captured within a short window or the
     * hold on the parent's card/UPI simply expires — auto-capture is
     * the correct default for a fee payment, not a manual-capture flow.
     */
    async createOrder(
        keyId: string,
        keySecret: string,
        params: CreateOrderParams
    ): Promise<CreatedOrder> {

        const razorpay = new Razorpay({

            key_id: keyId,

            key_secret: keySecret

        });

        const order = await razorpay.orders.create({

            amount: Math.round(params.amountInRupees * 100),

            currency: "INR",

            receipt: params.receipt,

            notes: params.notes,

            payment_capture: true

        });

        return {
            id: order.id,
            amount: Number(order.amount),
            currency: order.currency,
            receipt: order.receipt ?? params.receipt,
            status: order.status,
        };

    }

}

export const razorpayProvider =
    new RazorpayProvider();
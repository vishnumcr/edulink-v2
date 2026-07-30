/**
 * -------------------------------------------------------------
 * File:
 * index.ts
 *
 * Purpose:
 * Entry point for all Firebase Cloud Functions.
 *
 * Firebase only deploys functions that are exported from here.
 *
 * As EduLink grows, this file will simply re-export functions
 * from each module.
 * -------------------------------------------------------------
 */

// Initializes the Admin SDK (see services/firebaseAdmin.ts). This used
// to happen only as an accidental side effect of connect.ts importing
// requireRole.ts importing firebaseAdmin.ts — every function here
// happened to get a working admin.firestore() only because that one
// import chain ran first. Made explicit so it doesn't silently break
// if that chain is ever reordered or connect.ts is removed.
import "./services/firebaseAdmin";

// Payment Gateway
export { connectPaymentGateway } from "./paymentGateway/connect";

// Finance
// recordPayment existed but was never exported here, so it was never
// actually deployed — FinanceService.recordPayment on the client was
// calling a function that didn't exist in production.
export { recordPayment } from "./recordPayment";

// Online fee payment (parent-initiated) — createFeeOrder only CREATES
// the Razorpay order; paymentWebhook below is what actually confirms
// payment and applies it. Named/routed to match the URL
// settings/payment/page.tsx already displays to staff — see that
// file's own header for the naming/routing mismatch this fixed.
// The client-side checkout-handoff verification path (for immediate
// UI feedback right after Razorpay Checkout closes) is still
// separately unbuilt.
export { createFeeOrder } from "./createFeeOrder";
export { paymentWebhook } from "./paymentWebhook";

// Admission
export { collectAdmissionFee } from "./collectAdmissionFee";

// Parent identity — OTP sign-in
// Both are deliberately unauthenticated (see the ⚠️ note in each file)
// — a parent has no session until AFTER verifyOtp succeeds.
export { sendOtp } from "./parent/sendOtp";
export { verifyOtp } from "./parent/verifyOtp";


export { mockResolveParentSession } from "./parent/mockResolveParentSession";

// Teachers — Auth account creation. Not exported from parent/ since a
// teacher isn't a parent identity variant; own top-level module, own
// section here, same as every other feature above.
export { createTeacher } from "./teacher/createTeacher";

// Notices — the only writer for schools/{schoolId}/notices.
export { publishNotice } from "./notices/publishNotice";
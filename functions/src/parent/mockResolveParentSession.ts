import { onCall, HttpsError } from "firebase-functions/v2/https";
import { auth, db } from "../services/firebaseAdmin";
import { normalizeIndianPhone } from "../parent/identity";
import { ParentAccount } from "../parent/types";

export const mockResolveParentSession = onCall(
  { region: "asia-south1" },
  async (request) => {
    const phone = normalizeIndianPhone(request.data.phone);

    if (!phone) {
      throw new HttpsError(
        "invalid-argument",
        "Invalid phone number."
      );
    }

    const snap = await db
      .collection("users")
      .where("type", "==", "parent")
      .where("phone", "==", phone)
      .limit(1)
      .get();

    if (snap.empty) {
      throw new HttpsError(
        "not-found",
        "Parent account not found."
      );
    }

    const doc = snap.docs[0];
    const parent = doc.data() as ParentAccount;

    if (parent.status !== "active") {
      throw new HttpsError(
        "permission-denied",
        "Parent account is inactive."
      );
    }

    const customToken = await auth.createCustomToken(doc.id);

    return {
      success: true,
      customToken,
      parentUid: doc.id,
      eduLinkId: parent.eduLinkId,
      parentName: parent.name,
    };
  }
);
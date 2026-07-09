// Unit N/A record titles. Title tags let the gantt N/A display distinguish a
// sales referral (pending fleet review) from a fleet-confirmed out-of-service
// record — there's no dedicated schema field. Kept in a lib module (not the
// route file) because Next.js route files may only export HTTP methods + route
// config; any other named export fails `next build`. Keep in lockstep with the
// /referral|pending fleet review/i classifier in timeline-native's naByAsset.
export const NA_REFERRAL_TITLE = "Unit N/A — sales referral (pending fleet review)";
export const NA_FLEET_TITLE = "Unit N/A — out of service (fleet)";

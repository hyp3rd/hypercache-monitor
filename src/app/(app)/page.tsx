import { redirect } from "next/navigation";

/**
 * Root of the (app) group redirects to /topology — that's the
 * only Phase A surface. Server Component to avoid a flash of
 * blank page during the client-side router push.
 */
export default function AppIndex() {
  redirect("/topology");
}

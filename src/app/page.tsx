import { redirect } from "next/navigation";

// No landing page (out of scope): the app starts at the dashboard, which sends signed-out visitors to sign-in.
export default function Home() {
  redirect("/dashboard");
}

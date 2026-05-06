import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { redirect } from "next/navigation";
import MessagesClient from "./MessagesClient";

export default async function MessagesPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    redirect("/auth/login");
  }

  return (
    <MessagesClient
      userId={session.user.id}
      viewerUsername={session.user.name ?? session.user.email ?? "Вы"}
      viewerAvatarUrl={session.user.image ?? null}
    />
  );
}
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth-options";
import UserClient from "./user-client";

export default async function UserPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getServerSession(authOptions);

  return <UserClient userId={id} viewerId={session?.user?.id ?? null} />;
}
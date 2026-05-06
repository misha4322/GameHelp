import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { canViewAdminPanel, isAdminRole, parseAppRole } from "@/lib/roles";
import { isTempAdminSession } from "@/lib/admin-server";
import { AdminClient, type AdminTabKey } from "./AdminClient";
import "./AdminPanel.css";

export const metadata = {
  title: "Админ-панель | GameHelp",
};

function parseAdminTabKey(
  tab: string | null | undefined,
  hasOpenComment: boolean,
  hasOpenPost: boolean,
  canUseDictionaryTabs: boolean
): AdminTabKey {
  if (hasOpenComment) return "reports";
  /** Пост из ссылки: сразу вкладка «Модерация контента» + панель разбора откроется на клиенте. */
  if (hasOpenPost) return "moderation";
  const t = typeof tab === "string" ? tab.trim() : "";
  if (t === "censorship" || t === "tags") {
    return canUseDictionaryTabs ? (t as AdminTabKey) : "users";
  }
  if (t === "users" || t === "moderation" || t === "reports") return t as AdminTabKey;
  return "users";
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams?: Promise<{ openComment?: string; openPost?: string; tab?: string }>;
}) {
  const sp = searchParams ? await searchParams : {};
  const openComment =
    typeof sp.openComment === "string" && sp.openComment.trim() ? sp.openComment.trim() : null;
  const openPost =
    typeof sp.openPost === "string" && sp.openPost.trim() ? sp.openPost.trim() : null;

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    redirect("/auth/login?callbackUrl=/admin");
  }
  const roleRaw = session.user.role ?? "user";
  const appRole = parseAppRole(roleRaw);
  if (!canViewAdminPanel(roleRaw)) {
    if (!isTempAdminSession(session)) {
      redirect("/");
    }
  }
  const isTemp = isTempAdminSession(session);
  const isAdmin = isAdminRole(roleRaw) || isTemp;
  /** Цензура и теги форума — только у админа (или временного входа не-модератора), не у роли moderator. */
  const canUseDictionaryTabs =
    isAdminRole(roleRaw) || (isTemp && appRole !== "moderator");

  const initialTab = parseAdminTabKey(
    typeof sp.tab === "string" ? sp.tab : null,
    !!openComment,
    !!openPost,
    canUseDictionaryTabs
  );

  return (
    <div className="admin-page">
      <div className="container">
        <div className="admin-header">
          <h1 className="admin-title">Админ-панель</h1>
          <p className="admin-sub">
            {isAdmin
              ? "Полный доступ: роли, передача прав, баны, теги форума"
              : "Модератор: список пользователей, бан (кроме админов)"}
          </p>
        </div>
        <AdminClient
          isAdmin={isAdmin}
          canUseDictionaryTabs={canUseDictionaryTabs}
          myId={session.user.id}
          initialOpenCommentId={openComment}
          initialOpenPostSlug={openPost}
          initialTab={initialTab}
        />
      </div>
    </div>
  );
}

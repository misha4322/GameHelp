import Link from "next/link";
import { getServerSessionSafe } from "@/lib/safe-session";
import type { RecommendationsHomeResponse } from "@/types/recommendations";
import { HOME_FOR_YOU_DEFAULT_LIMIT } from "@/lib/recommendations-display";
import { getRecommendationsHome } from "@/server/recommendations-service";
import { HomeHero } from "@/app/home/components/HomeHero";
import { HomeRecsSection } from "@/app/home/components/HomeRecsSection";
import { HomeCta } from "@/app/home/components/HomeCta";
import "./Home.css";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await getServerSessionSafe();
  const viewerId = session?.user?.id ?? null;
  let recs: RecommendationsHomeResponse | null = null;

  try {
    recs = await getRecommendationsHome(viewerId, HOME_FOR_YOU_DEFAULT_LIMIT);
  } catch (e) {
    console.error("Home recommendations failed:", e);
    recs = null;
  }

  return (
    <div className="home-page">
      <HomeHero isAuthed={!!session} />

      {recs ? (
        <HomeRecsSection
          viewerId={viewerId}
          initialForYou={recs.blocks.forYou}
          initialTrending={recs.blocks.trending}
        />
      ) : null}

      <section className="container home-section">
        <div className="home-section-header">
          <div>
            <div className="home-section-kicker">Навигация</div>
            <h2 className="home-section-title">Быстрый доступ к разделам</h2>
          </div>
        </div>
        <div className="home-features">
          <Link className="home-feature" href="/posts">
            <div className="home-feature-icon">📝</div>
            <h3 className="home-feature-title">Форум</h3>
            <p className="home-feature-text">
              Персональные рекомендации, фильтры по играм и тегам, обсуждения.
            </p>
          </Link>
          <Link className="home-feature" href="/friends">
            <div className="home-feature-icon">👥</div>
            <h3 className="home-feature-title">Друзья</h3>
            <p className="home-feature-text">Поиск людей, добавление в друзья и связи.</p>
          </Link>
          <Link className="home-feature" href="/messages">
            <div className="home-feature-icon">📨</div>
            <h3 className="home-feature-title">Сообщения</h3>
            <p className="home-feature-text">Личные диалоги и отправка постов в чат.</p>
          </Link>
          <Link className="home-feature" href="/profile">
            <div className="home-feature-icon">🎮</div>
            <h3 className="home-feature-title">Профиль</h3>
            <p className="home-feature-text">Настройки аккаунта и игровые интересы.</p>
          </Link>
        </div>
      </section>

      <HomeCta isAuthed={!!session} />
    </div>
  );
}

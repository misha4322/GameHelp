import Link from "next/link";

type HomeHeroProps = {
  isAuthed: boolean;
};

export function HomeHero({ isAuthed }: HomeHeroProps) {
  return (
    <section className="container home-hero">
      <div className="home-copy">
        <div className="home-badge">GameHelp Portal</div>
        <h1 className="home-title">
          Игровое сообщество
          <span> с умным форумом</span>
        </h1>
        <p className="home-subtitle">
          Персональные рекомендации, фильтры по играм и тегам — на странице форума. Здесь краткий обзор и
          быстрый доступ к разделам.
        </p>

        <div className="home-actions">
          {isAuthed ? (
            <>
              <Link href="/posts" className="home-button primary">
                Открыть форум
              </Link>
              <Link href="/messages" className="home-button secondary">
                Сообщения
              </Link>
            </>
          ) : (
            <>
              <Link href="/auth/register" className="home-button primary">
                Создать аккаунт
              </Link>
              <Link href="/auth/login" className="home-button secondary">
                Войти
              </Link>
            </>
          )}
        </div>
      </div>

      <div className="home-preview-card">
        <div className="home-preview-label">Форум</div>
        <div className="home-preview-title">Что внутри /posts</div>
        <div className="home-preview-list">
          <div className="home-preview-item">
            <span className="home-preview-icon">🎯</span>
            <div>
              <div className="home-preview-item-title">Рекомендации</div>
              <div className="home-preview-item-text">
                Блоки «для вас», друзья, тренды и ваши теги — после входа в аккаунт.
              </div>
            </div>
          </div>
          <div className="home-preview-item">
            <span className="home-preview-icon">🎮</span>
            <div>
              <div className="home-preview-item-title">Фильтры по играм</div>
              <div className="home-preview-item-text">До 10 категорий, мгновенное обновление по Enter.</div>
            </div>
          </div>
          <div className="home-preview-item">
            <span className="home-preview-icon">🏷️</span>
            <div>
              <div className="home-preview-item-title">Теги</div>
              <div className="home-preview-item-text">Любое число тегов: пост подходит, если есть хотя бы один.</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

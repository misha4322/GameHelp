import Link from "next/link";

type HomeCtaProps = {
  isAuthed: boolean;
};

export function HomeCta({ isAuthed }: HomeCtaProps) {
  return (
    <section className="container home-cta">
      <div className="home-cta-card">
        <div>
          <div className="home-section-kicker">GameHelp Platform</div>
          <h2 className="home-section-title">Сделаем ленту еще точнее</h2>
          <p className="home-cta-text">
            Чем больше действий на сайте (лайки, комментарии, друзья, обсуждения), тем точнее
            рекомендации и тем быстрее вы найдете интересный контент.
          </p>
        </div>
        <div className="home-cta-actions">
          {isAuthed ? (
            <Link href="/posts/new" className="home-button primary">
              Создать пост
            </Link>
          ) : (
            <>
              <Link href="/auth/register" className="home-button primary">
                Зарегистрироваться
              </Link>
              <Link href="/auth/login" className="home-button secondary">
                Войти в аккаунт
              </Link>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

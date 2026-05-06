import Link from "next/link";

export default function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="footer">
      <div className="container footer-inner">
        <div className="footer-left">
          <div className="footer-logo">🎮 GameHelp</div>
          <div className="footer-muted">
            Игровое сообщество для обсуждений, советов, поиска друзей и общения • © {year}
          </div>
        </div>

        <div className="footer-links">
          <Link href="/">Главная</Link>
          <Link href="/posts">Форум</Link>
          <Link href="/auth/login">Войти</Link>
          <Link href="/auth/register">Регистрация</Link>
        </div>
      </div>
    </footer>
  );
}

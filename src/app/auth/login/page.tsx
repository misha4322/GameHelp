import LoginForm from "./LoginForm";
import SocialButtons from "../components/social/SocialButtons";
import Link from "next/link";
import Image from "next/image";
import "../AuthPage.css";

export default function LoginPage() {
  return (
    <div className="auth-page">
      <div className="auth-bg">
        <div className="auth-glow one"></div>
        <div className="auth-glow two"></div>
        <div className="auth-glow three"></div>
      </div>

      <div className="auth-shell">
        <div className="auth-card">
          <div className="auth-header">
            <div className="auth-logo">
              <Image
                src="/fox.png"
                alt="Kitsune"
                width={32}
                height={32}
              />
            </div>
            <h1 className="auth-title">Вход</h1>
            <p className="auth-subtitle">Войдите в свой аккаунт</p>
          </div>

          <LoginForm />

          <div className="auth-divider">
            <div className="auth-divider-line"></div>
            <span className="auth-divider-text">или</span>
            <div className="auth-divider-line"></div>
          </div>

          <SocialButtons isLogin={true} />

          <div className="auth-footer">
            <p>
              Нет аккаунта?{" "}
              <Link href="/auth/register" className="auth-link">
                Зарегистрироваться
              </Link>
            </p>
            <Link href="/" className="auth-back-link">
              ← Вернуться на главную
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
import RegisterForm from "./RegisterForm";
import SocialButtons from "../components/social/SocialButtons";
import Link from "next/link";
import "../AuthPage.css";

export default function RegisterPage() {
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
              🎮
            </div>
            <h1 className="auth-title">Регистрация</h1>
            <p className="auth-subtitle">Создайте свой аккаунт</p>
          </div>

          <RegisterForm />

          <div className="auth-divider">
            <div className="auth-divider-line"></div>
            <span className="auth-divider-text">или</span>
            <div className="auth-divider-line"></div>
          </div>

          <SocialButtons isLogin={false} />

          <div className="auth-footer">
            <p>
              Уже есть аккаунт?{" "}
              <Link href="/auth/login" className="auth-link">
                Войти
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
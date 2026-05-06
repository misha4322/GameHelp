"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { Eye, EyeOff, Mail, Lock } from "lucide-react";
import "./LoginForm.css";

export default function LoginForm() {
  const [error, setError] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    const form = e.currentTarget as HTMLFormElement;
    const email = (form.elements.namedItem("email") as HTMLInputElement).value;
    const password = (form.elements.namedItem("password") as HTMLInputElement).value;

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    setIsLoading(false);

    if (result?.error) {
      setError("Неверный email или пароль. Проверьте данные и попробуйте снова.");
    } else {
      window.location.href = "/profile";
    }
  };

  return (
    <>
      {error && (
        <div className="form-error">
          <div className="error-badge">!</div>
          <p className="error-message">{error}</p>
        </div>
      )}
      
      <form onSubmit={handleSubmit} className="login-form">
        <div className="form-group">
          <label className="form-label">Email аккаунта</label>
          <div className="input-wrapper">
            <Mail className="input-icon" />
            <input
              name="email"
              type="email"
              placeholder="gamer@example.com"
              className="form-input"
              required
            />
          </div>
        </div>

        <div className="form-group">
          <div className="label-row">
            <label className="form-label">Пароль</label>
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="show-password-btn"
            >
              {showPassword ? "Скрыть" : "Показать"}
            </button>
          </div>
          <div className="input-wrapper">
            <Lock className="input-icon" />
            <input
              name="password"
              type={showPassword ? "text" : "password"}
              placeholder="Ваш пароль"
              className="form-input"
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="password-toggle"
            >
              {showPassword ? (
                <EyeOff className="toggle-icon" />
              ) : (
                <Eye className="toggle-icon" />
              )}
            </button>
          </div>
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="submit-btn"
        >
          {isLoading ? (
            <>
              <div className="spinner"></div>
              <span>Входим...</span>
            </>
          ) : (
            <span>Войти в аккаунт</span>
          )}
        </button>

        <div className="form-footer">
          <a href="#" className="forgot-link">
            Забыли пароль?
          </a>
        </div>
      </form>
    </>
  );
}
"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, User, Mail, Lock } from "lucide-react";

import { apiRequest } from "@/lib/api";
import "./RegisterForm.css";

export default function RegisterForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    const form = e.currentTarget;
    const username = (form.elements.namedItem("username") as HTMLInputElement).value;
    const email = (form.elements.namedItem("email") as HTMLInputElement).value;
    const password = (form.elements.namedItem("password") as HTMLInputElement).value;

    try {
      await apiRequest("/auth/register", {
        method: "POST",
        body: JSON.stringify({
          username,
          email,
          password,
        }),
      });

      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });

      if (result?.error) {
        setError("Ошибка при входе после регистрации");
        setIsLoading(false);
        return;
      }

      router.push("/profile");
      router.refresh();
    } catch (err) {
      console.error("Ошибка регистрации:", err);
      setError(
        err instanceof Error
          ? err.message
          : "Внутренняя ошибка сервера. Пожалуйста, попробуйте позже."
      );
      setIsLoading(false);
    }
  };

  return (
    <>
      {error && (
        <div className="register-error">{error}</div>
      )}

      <form onSubmit={handleSubmit} className="register-form">
        <div className="register-group">
          <label className="register-label">Имя пользователя</label>
          <div className="register-input-wrap">
            <User className="register-icon" />
            <input
              name="username"
              type="text"
              placeholder="Введите ваше имя"
              className="register-input"
              required
              minLength={3}
              maxLength={32}
            />
          </div>
        </div>

        <div className="register-group">
          <label className="register-label">Email</label>
          <div className="register-input-wrap">
            <Mail className="register-icon" />
            <input
              name="email"
              type="email"
              placeholder="your.email@example.com"
              className="register-input"
              required
            />
          </div>
        </div>

        <div className="register-group">
          <div className="register-label-row">
            <label className="register-label">Пароль</label>
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="register-toggle-text"
            >
              {showPassword ? "Скрыть" : "Показать"}
            </button>
          </div>

          <div className="register-input-wrap">
            <Lock className="register-icon" />
            <input
              name="password"
              type={showPassword ? "text" : "password"}
              placeholder="Придумайте надежный пароль"
              className="register-input register-input-password"
              required
              minLength={6}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="register-eye-button"
            >
              {showPassword ? (
                <EyeOff className="register-eye-icon" />
              ) : (
                <Eye className="register-eye-icon" />
              )}
            </button>
          </div>

          <p className="register-hint">Минимум 6 символов</p>
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="register-submit"
        >
          {isLoading ? (
            <>
              <div className="register-spinner"></div>
              <span>Регистрация...</span>
            </>
          ) : (
            <span>Зарегистрироваться</span>
          )}
        </button>
      </form>
    </>
  );
}
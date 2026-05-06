"use client";

import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import "./AuthErrorPage.css";

function AuthErrorPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const error = searchParams.get("error");
  const [errorMessage, setErrorMessage] = useState<string>("");

  useEffect(() => {
    const messages: Record<string, string> = {
      "OAuthSignin": "Не удалось подключиться к социальной сети",
      "OAuthCallback": "Ошибка обработки ответа от социальной сети",
      "OAuthCreateAccount": "Не удалось создать аккаунт через социальную сеть",
      "EmailCreateAccount": "Ошибка создания аккаунта по email",
      "Callback": "Ошибка при обработке запроса",
      "OAuthAccountNotLinked": "Этот email уже привязан к другому аккаунту",
      "EmailSignin": "Ошибка отправки email",
      "CredentialsSignin": "Неверный email или пароль",
      "SessionRequired": "Требуется авторизация",
      "Default": "Произошла неизвестная ошибка"
    };

    if (error && messages[error]) {
      setErrorMessage(messages[error]);
    } else {
      setErrorMessage(messages["Default"]);
    }
  }, [error]);

  const handleRetry = () => {
    router.back();
  };

  return (
    <div className="error-page-container">
      <div className="error-content">
        <div className="error-icon">⚠️</div>
        
        <h1 className="error-title">Ошибка авторизации</h1>
        <p className="error-subtitle">Не удалось войти в систему</p>
        
        <div className="error-message-box">
          <p className="error-text">{errorMessage}</p>
          {error && (
            <p className="error-code">Код ошибки: {error}</p>
          )}
        </div>

        <div className="error-actions">
          <button
            onClick={handleRetry}
            className="btn-primary"
          >
            Попробовать снова
          </button>
          
          <div className="error-links">
            <Link
              href="/auth/login"
              className="error-link"
            >
              <span>Войти в аккаунт</span>
            </Link>
            
            <Link
              href="/auth/register"
              className="error-link"
            >
              <span>Создать аккаунт</span>
            </Link>
          </div>
          
          <Link
            href="/"
            className="home-link"
          >
            ← На главную страницу
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function AuthErrorPage() {
  return (
    <Suspense fallback={<div className="error-page-container" />}>
      <AuthErrorPageContent />
    </Suspense>
  );
}
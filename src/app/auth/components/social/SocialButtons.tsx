"use client";

import { signIn } from "next-auth/react";
import Image from "next/image";
import "./SocialButtons.css";

export default function SocialButtons({ isLogin = true }) {
  const handleSocialLogin = (provider: string) => {
    signIn(provider, { callbackUrl: "/profile" });
  };

  return (
    <div className="social-buttons">
      <button
        type="button"
        onClick={() => handleSocialLogin("google")}
        className="social-btn social-google"
      >
        <div className="social-icon">
          <Image
            src="/google.png"
            alt="Войти через Google"
            width={24}
            height={24}
          />
        </div>
        <span>{isLogin ? "Войти" : "Зарегистрироваться"} через Google</span>
      </button>

      <button
        type="button"
        onClick={() => handleSocialLogin("yandex")}
        className="social-btn social-yandex"
      >
        <div className="social-icon">
          <Image
            src="/yandex.png"
            alt="Войти через Яндекс"
            width={24}
            height={24}
          />
        </div>
        <span>{isLogin ? "Войти" : "Зарегистрироваться"} через Яндекс</span>
      </button>

      <button
        type="button"
        onClick={() => handleSocialLogin("steam")}
        className="social-btn social-steam"
      >
        <div className="social-icon">
          <Image
            src="/steam.png"
            alt="Войти через Steam"
            width={24}
            height={24}
          />
        </div>
        <span>{isLogin ? "Войти" : "Зарегистрироваться"} через Steam</span>
      </button>
    </div>
  );
}

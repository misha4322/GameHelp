export type SettingsUser = {
  id: string;
  username: string;
  email: string | null;
  avatarUrl: string | null;
  profileBannerUrl: string | null;
  statusText: string | null;
  bio: string | null;
  location: string | null;
  websiteUrl: string | null;
  telegram: string | null;
  discord: string | null;
  steamProfileUrl: string | null;
  favoriteGames: string | null;
  showEmail: boolean;
  isProfilePrivate: boolean;
  createdAt: string | null;
};

export type SettingsResponse = {
  user: SettingsUser;
};

export type SteamGameBase = {
  appid: number;
  name: string;
};

export type SteamGame = SteamGameBase & {
  headerImage: string;
  capsuleImage: string;
};

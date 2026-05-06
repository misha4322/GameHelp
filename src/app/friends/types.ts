export type FriendStatus = "self" | "friends" | "incoming" | "outgoing" | "none";

export type FriendUser = {
  id: string;
  username: string;
  avatarUrl?: string | null;
  friendStatus?: FriendStatus;
};

export type FriendRequest = {
  from: FriendUser;
  createdAt?: string | null;
};

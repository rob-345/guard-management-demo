import { getCollection } from "@/lib/mongodb";
import { getSession } from "@/lib/auth";
import type { CurrentUser, User } from "@/lib/types";

type UserProfile = Pick<User, "id"> & {
  first_name?: string;
  last_name?: string;
};

function buildInitials(name: string) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return initials || name.slice(0, 2).toUpperCase() || "U";
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await getSession();
  if (!session?.user?.id) return null;

  const [authUsers, userProfiles] = await Promise.all([
    getCollection<User>("auth_users"),
    getCollection<UserProfile>("user_profiles"),
  ]);

  const [authUser, profile] = await Promise.all([
    authUsers.findOne({ id: session.user.id }),
    userProfiles.findOne({ id: session.user.id }),
  ]);

  if (authUser?.is_active === false) {
    return null;
  }

  const name =
    [profile?.first_name, profile?.last_name].filter(Boolean).join(" ").trim() ||
    authUser?.email ||
    session.user.email;

  return {
    id: session.user.id,
    email: authUser?.email || session.user.email,
    name,
    initials: buildInitials(name),
  };
}

import type { User } from '@prisma/client';

/**
 * Public user shape — never exposes passwordHash.
 */
export interface UserEntity {
  id: number;
  username: string;
  email: string;
  createdAt: Date;
}

export function toPublicUser(user: User): UserEntity {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    createdAt: user.createdAt,
  };
}

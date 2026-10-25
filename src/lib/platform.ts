// Platform aggregator primitives — same shape as docs-mcp's platform.ts.
// A Platform is any aggregator that provisions sub-accounts on this skill
// (paperloft, cursor-marketplace, custom clients). Shared-secret auth on
// every provisioning + granting call.
//
// Data model (see prisma/schema.prisma):
//   Platform      — one row per aggregator, with a sha256'd secret
//   PlatformPool  — credit pool the aggregator tops up (or is granted)
//   User          — optional (platformId, platformRef); NULL = direct signup

import { createHash } from 'node:crypto';
import { prisma } from './db';
import { generateKey } from './keys';
import type { Platform } from '@prisma/client';

const FREE_TIER_ON_PROVISION = 100; // emails allowed at account creation

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export async function authPlatform(req: Request): Promise<Platform | null> {
  const raw = req.headers.get('x-platform-secret') || '';
  if (!raw) return null;
  const hash = sha256(raw);
  return await prisma.platform.findUnique({ where: { sharedSecretHash: hash } });
}

export async function provisionUser(
  platformId: string,
  platformRef: string,
  email?: string,
): Promise<{ userId: string; apiKey: string | null; keyPrefix: string; isNew: boolean }> {
  let user = await prisma.user.findUnique({
    where: { platformId_platformRef: { platformId, platformRef } },
  });

  let isNew = false;
  if (!user && email) {
    const existingByEmail = await prisma.user.findUnique({ where: { email } });
    if (existingByEmail) {
      if (existingByEmail.platformId && existingByEmail.platformId !== platformId) {
        throw new Error(
          `user ${email} is already provisioned under a different platform; cannot cross-attach`,
        );
      }
      user = await prisma.user.update({
        where: { id: existingByEmail.id },
        data: { platformId, platformRef },
      });
      if (!existingByEmail.platformId) {
        await prisma.apiKey.updateMany({
          where: { userId: user.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
    }
  }

  if (!user) {
    const finalEmail = email ?? `${platformRef}@${platformId}.platform.local`;
    user = await prisma.user.create({
      data: {
        platformId,
        platformRef,
        email: finalEmail,
        creditBalance: FREE_TIER_ON_PROVISION,
      },
    });
    isNew = true;

    await prisma.creditTransaction.create({
      data: {
        userId: user.id,
        delta: FREE_TIER_ON_PROVISION,
        reason: 'trial',
        metadata: { platformId, platformRef },
      },
    });
  }

  const activeKey = await prisma.apiKey.findFirst({
    where: { userId: user.id, revokedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  if (activeKey) {
    return { userId: user.id, apiKey: null, keyPrefix: activeKey.keyPrefix, isNew };
  }

  const gen = generateKey();
  await prisma.apiKey.create({
    data: { userId: user.id, keyHash: gen.hash, keyPrefix: gen.displayPrefix },
  });
  return { userId: user.id, apiKey: gen.raw, keyPrefix: gen.displayPrefix, isNew };
}

export async function grantFromPool(
  platformId: string,
  userId: string,
  amount: number,
  reason: string = 'platform_grant',
): Promise<{ newBalance: number; poolBalance: number }> {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error(`amount must be a positive integer, got ${amount}`);
  }
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { platformId: true },
  });
  if (!user) throw new Error(`user ${userId} not found`);
  if (user.platformId !== platformId) {
    throw new Error(`user ${userId} does not belong to platform ${platformId}`);
  }

  const result = await prisma.$transaction(async (tx) => {
    const poolUpd = await tx.platformPool.updateMany({
      where: { platformId, balance: { gte: amount } },
      data: { balance: { decrement: amount } },
    });
    if (poolUpd.count === 0) {
      const pool = await tx.platformPool.findUnique({ where: { platformId } });
      throw new Error(`platform pool has ${pool?.balance ?? 0} credits, need ${amount}`);
    }
    const freshUser = await tx.user.update({
      where: { id: userId },
      data: { creditBalance: { increment: amount } },
      select: { creditBalance: true },
    });
    await tx.creditTransaction.create({
      data: { userId, delta: amount, reason, metadata: { platformId } },
    });
    const freshPool = await tx.platformPool.findUnique({ where: { platformId } });
    return {
      newBalance: freshUser.creditBalance,
      poolBalance: freshPool?.balance ?? 0,
    };
  });
  return result;
}

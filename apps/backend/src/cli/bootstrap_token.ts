import 'dotenv/config';

import jwt from 'jsonwebtoken';

import { env } from '../env.js';
import { prisma } from '../prisma.js';

async function main() {
  const telegramId = 'dev';

  await prisma.user.upsert({
    where: { telegramId },
    create: { telegramId, isAllowed: true },
    update: { isAllowed: true },
  });

  const token = jwt.sign(
    {
      sub: telegramId,
      t: 'dev',
    },
    env.JWT_SECRET,
    {
      algorithm: 'HS256',
      expiresIn: '7d',
    },
  );

  // eslint-disable-next-line no-console
  console.log(token);
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

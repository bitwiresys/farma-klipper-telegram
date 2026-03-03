import { Telegraf, Markup } from 'telegraf';

import { PrinterState } from '@farma/shared';

import { env, getAllowedTelegramUserIds } from './env.js';
import { prisma } from './prisma.js';
import { printerRuntime } from './printer_runtime.js';
import { logger } from './logger.js';

export function startTelegramBot() {
  const bot = new Telegraf(env.TELEGRAM_BOT_TOKEN);

  bot.start(async (ctx) => {
    const telegramUserId = String(ctx.from?.id ?? '');
    const chatId = String(ctx.chat?.id ?? '');
    if (!telegramUserId || !chatId) return;

    const allowed = getAllowedTelegramUserIds();
    const isAllowed =
      allowed.size === 0 ? true : allowed.has(Number(telegramUserId));

    await prisma.user.upsert({
      where: { telegramId: telegramUserId },
      create: {
        telegramId: telegramUserId,
        chatId,
        isAllowed,
      },
      update: {
        chatId,
        isAllowed,
      },
    });

    await ctx.reply(
      'Open panel:',
      Markup.inlineKeyboard([
        Markup.button.webApp('Open panel', env.TELEGRAM_WEBAPP_URL),
      ]),
    );
  });

  bot.command('status', async (ctx) => {
    const printers = await prisma.printer.findMany();

    const counts: Record<string, number> = {
      printing: 0,
      paused: 0,
      error: 0,
      standby: 0,
      offline: 0,
    };

    for (const p of printers) {
      const s = printerRuntime.getSnapshot(p.id);
      const st = s.state;
      if (st === PrinterState.printing) counts.printing++;
      else if (st === PrinterState.paused) counts.paused++;
      else if (st === PrinterState.error) counts.error++;
      else if (st === PrinterState.standby) counts.standby++;
      else counts.offline++;
    }

    const text = [
      'STATUS',
      `printing: ${counts.printing}`,
      `paused: ${counts.paused}`,
      `error: ${counts.error}`,
      `standby: ${counts.standby}`,
      `offline: ${counts.offline}`,
    ].join('\n');

    await ctx.reply(text);
  });

  bot.launch().then(() => {
    logger.info('telegram bot launched');
  });

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));

  return bot;
}

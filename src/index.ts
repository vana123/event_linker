// src/bot.ts

import 'dotenv/config';
import { Telegraf, session, Scenes, Context, Markup } from 'telegraf';
import { createEvent } from 'ics';
import moment from 'moment-timezone'; // Add this import for date parsing

// 1) Описуємо дані події
interface EventData {
  title: string;
  date: string;    // у форматі YYYY-MM-DD
  time: string;    // у форматі HH:mm
  location: string;
}

// 2) Розширюємо WizardSessionData, щоб в ньому було поле event
interface MyWizardSession extends Scenes.WizardSessionData, Scenes.SceneSession<MyWizardSession> {
  event?: EventData;
}

// 3) Власний контекст для бота
//    - наслідуємо базовий Context
//    - додаємо session і властивості для сцен
type MyContext = Context & {
  session: MyWizardSession;
  scene: Scenes.SceneContextScene<MyContext, MyWizardSession>;
  wizard: Scenes.WizardContextWizard<MyContext>;
};

// 4) Створюємо WizardScene із кроками
const createEventWizard = new Scenes.WizardScene<MyContext>(
  'create-event-wizard',

  // Крок 1: Назва
  (ctx) => {
    ctx.session.event = { title: '', date: '', time: '', location: '' };
    ctx.reply('📝 Введіть назву події:');
    return ctx.wizard.next() as unknown as void;
  },

  // Крок 2: Дата
  (ctx) => {
    const text = ctx.message && 'text' in ctx.message ? (ctx.message as { text: string }).text : undefined;
    ctx.session.event!.title = typeof text === 'string' ? text.trim() : '';

    const today = moment().format('YYYY-MM-DD');
    const tomorrow = moment().add(1, 'day').format('YYYY-MM-DD');
    const dayAfterTomorrow = moment().add(2, 'days').format('YYYY-MM-DD');

    ctx.reply(
      '📅 Вкажіть дату події:'
    );
    return ctx.wizard.next() as unknown as void;
  },

  // Крок 3: Час
  (ctx) => {
    const text = ctx.message && 'text' in ctx.message ? (ctx.message as { text: string }).text : undefined;
    const dateInput = typeof text === 'string' ? text.trim() : '';
    const parsedDate = moment(dateInput, [
      'YYYY-MM-DD', 'YYYY MM DD', 'YYYY/MM/DD',
      'YY-MM-DD', 'YY MM DD', 'YY/MM/DD',
      'DD-MM-YYYY', 'DD/MM/YYYY', 'DD.MM.YYYY',
      'D-M-YYYY', 'D/M/YYYY',
      'DD-MM-YY', 'DD/MM/YY', 'DD.MM.YY',
      'D-M-YY', 'D/M/YY',
      'DD MMM YYYY', 'D MMM YYYY',
      'DD MMMM YYYY', 'D MMMM YYYY',
      'MMMM D, YYYY', 'MMMM DD, YYYY', 'DD,MM,YYYY', 'DD,MM,YYYY',   ], true);

    if (!parsedDate.isValid()) {
      ctx.reply('⚠️ Невірний формат дати. Спробуйте ще раз:');
      return; // Stay on the same step
    }

    ctx.session.event!.date = parsedDate.format('YYYY-MM-DD');
    ctx.reply('⏰ Вкажіть час події');
    return ctx.wizard.next() as unknown as void;
  },

  // Крок 4: Місце
  (ctx) => {
    const text = ctx.message && 'text' in ctx.message ? (ctx.message as { text: string }).text : undefined;
    const timeInput = typeof text === 'string' ? text.trim() : '';
    const parsedTime = moment(timeInput, [
      'HH:mm', 'H:mm', 'HH.mm', 'H.mm',
      'HH-mm', 'H-mm', 'HH mm', 'H mm',
      'HH:mm:ss', 'H:mm:ss', 'hh:mm A', 'h:mm A',
      'hh:mm:ss A', 'h:mm:ss A'
    ], true);

    if (!parsedTime.isValid()) {
      ctx.reply('⚠️ Невірний формат часу. Спробуйте ще раз');
      return; // Stay on the same step
    }

    ctx.session.event!.time = parsedTime.format('HH:mm');
    ctx.reply('📍 Вкажіть місце проведення події:');
    return ctx.wizard.next() as unknown as void;
  },

  // Фінальний крок: генеруємо посилання та ICS
  async (ctx) => {
    const text = ctx.message && 'text' in ctx.message ? (ctx.message as { text: string }).text : undefined;
    ctx.session.event!.location = typeof text === 'string' ? text.trim() : '';
    const { title, date, time, location } = ctx.session.event!;

    // 1) Формуємо moment з локальною зоною Europe/Kyiv
    const startMoment = moment.tz(`${date} ${time}`, 'YYYY-MM-DD HH:mm', 'Europe/Kyiv');
    const endMoment = startMoment.clone().add(1, 'hour');

    // 2) Формат для Google Calendar (без Z) + timezone
    const startFmt = startMoment.format('YYYYMMDDTHHmmss');
    const endFmt = endMoment.format('YYYYMMDDTHHmmss');
    const dates = `${startFmt}/${endFmt}`;
    const gcLink = [
      'https://calendar.google.com/calendar/render',
      '?action=TEMPLATE',
      `&text=${encodeURIComponent(title)}`,
      `&dates=${dates}`,
      `&location=${encodeURIComponent(location)}`,
      `&ctz=${encodeURIComponent('Europe/Kyiv')}`,
      '&sf=true&output=xml'
    ].join('');

    // 3) Генеруємо ICS-файл
    const y = startMoment.year();
    const m = startMoment.month() + 1;
    const d = startMoment.date();
    const h = startMoment.hour();
    const min = startMoment.minute();
    const { error, value } = createEvent({
      title,
      start: [y, m, d, h, min],
      duration: { hours: 1 },
      location,
      startInputType: 'local',
      startOutputType: 'local'
    });

    await ctx.reply(
      `✅ Подію збережено!\n\n` +
      `🔗 <b>Google Calendar</b>: <a href="${gcLink}">Додати в календар ${title}</a> \n\n
      /addevent - Сворити наступну пдію`,
      { parse_mode: 'HTML', ...Markup.removeKeyboard() }
    );

    return ctx.scene.leave();
  }
);

// 5) Реєструємо сцену в Stage і налаштовуємо middleware
const stage = new Scenes.Stage<MyContext>([createEventWizard]);
const bot = new Telegraf<MyContext>(process.env.BOT_TOKEN!);

bot.use(session());
bot.use(stage.middleware());

// Команда для запуску wizard
bot.command('addevent', (ctx) => ctx.scene.enter('create-event-wizard'));


bot.launch()
  .then(() => console.log('Bot started'))
  .catch(console.error);

export type Locale = 'en' | 'ru';

export const LOCALES: Locale[] = ['en', 'ru'];

export const DEFAULT_LOCALE: Locale = 'en';

// Translation dictionaries
const translations: Record<Locale, Record<string, string>> = {
  en: {
    // Navigation
    'nav.dashboard': 'Dashboard',
    'nav.printers': 'Printers',
    'nav.presets': 'Presets',
    'nav.history': 'History',
    'nav.settings': 'Settings',
    'nav.analytics': 'Analytics',

    // Status
    'status.printing': 'Printing',
    'status.paused': 'Paused',
    'status.standby': 'Standby',
    'status.error': 'Error',
    'status.complete': 'Complete',
    'status.cancelled': 'Cancelled',

    // Actions
    'action.pause': 'Pause',
    'action.resume': 'Resume',
    'action.cancel': 'Cancel',
    'action.pauseAll': 'Pause all',
    'action.resumeAll': 'Resume all',
    'action.cancelAll': 'Cancel all',
    'action.confirm': 'Confirm',
    'action.close': 'Close',
    'action.save': 'Save',
    'action.delete': 'Delete',
    'action.edit': 'Edit',
    'action.export': 'Export',
    'action.loadMore': 'Load more',
    'action.clearFilters': 'Clear filters',

    // Dashboard
    'dashboard.title': 'Dashboard',
    'dashboard.noPrinters': 'No printers connected',
    'dashboard.viewMode.cards': 'Cards',
    'dashboard.viewMode.compact': 'Compact',
    'dashboard.progressComparison': 'Progress comparison',

    // Printers
    'printers.title': 'Printers',
    'printers.add': 'Add printer',
    'printers.edit': 'Edit printer',
    'printers.delete': 'Delete printer',
    'printers.name': 'Name',
    'printers.host': 'Host',
    'printers.port': 'Port',
    'printers.apiKey': 'API Key',

    // History
    'history.title': 'History',
    'history.noHistory': 'No history',
    'history.filters': 'Filters',
    'history.printer': 'Printer',
    'history.allPrinters': 'All printers',
    'history.dateFrom': 'From',
    'history.dateTo': 'To',
    'history.noMatches': 'No matches for selected filters',

    // Settings
    'settings.title': 'Settings',
    'settings.notifications': 'Notifications',
    'settings.pushEnabled': 'Push notifications',
    'settings.pushEnable': 'Enable push',
    'settings.pushDisable': 'Disable push',
    'settings.language': 'Language',
    'settings.theme': 'Theme',
    'settings.about': 'About',

    // Analytics
    'analytics.title': 'Analytics',
    'analytics.successRate': 'Success rate',
    'analytics.filamentUsed': 'Filament used',
    'analytics.avgPrintTime': 'Avg print time',
    'analytics.activePrinters': 'Active printers',
    'analytics.printerUsage': 'Printer usage',
    'analytics.filamentByPrinter': 'Filament by printer',
    'analytics.prints': 'Prints',
    'analytics.errors': 'Errors',

    // Common
    'common.loading': 'Loading...',
    'common.error': 'Error',
    'common.success': 'Success',
    'common.confirmation': 'Are you sure?',
    'common.yes': 'Yes',
    'common.no': 'No',
    'common.cancel': 'Cancel',
    'common.offline': 'Offline',
    'common.online': 'Online',
    'common.hours': 'h',
    'common.minutes': 'm',
    'common.meters': 'm',
    'common.millimeters': 'mm',
  },

  ru: {
    // Navigation
    'nav.dashboard': 'Дашборд',
    'nav.printers': 'Принтеры',
    'nav.presets': 'Пресеты',
    'nav.history': 'История',
    'nav.settings': 'Настройки',
    'nav.analytics': 'Аналитика',

    // Status
    'status.printing': 'Печать',
    'status.paused': 'Пауза',
    'status.standby': 'Ожидание',
    'status.error': 'Ошибка',
    'status.complete': 'Готово',
    'status.cancelled': 'Отменено',

    // Actions
    'action.pause': 'Пауза',
    'action.resume': 'Продолжить',
    'action.cancel': 'Отменить',
    'action.pauseAll': 'Пауза всем',
    'action.resumeAll': 'Продолжить все',
    'action.cancelAll': 'Отменить все',
    'action.confirm': 'Подтвердить',
    'action.close': 'Закрыть',
    'action.save': 'Сохранить',
    'action.delete': 'Удалить',
    'action.edit': 'Редактировать',
    'action.export': 'Экспорт',
    'action.loadMore': 'Загрузить ещё',
    'action.clearFilters': 'Сбросить фильтры',

    // Dashboard
    'dashboard.title': 'Дашборд',
    'dashboard.noPrinters': 'Нет подключённых принтеров',
    'dashboard.viewMode.cards': 'Карточки',
    'dashboard.viewMode.compact': 'Компактный',
    'dashboard.progressComparison': 'Сравнение прогресса',

    // Printers
    'printers.title': 'Принтеры',
    'printers.add': 'Добавить принтер',
    'printers.edit': 'Редактировать принтер',
    'printers.delete': 'Удалить принтер',
    'printers.name': 'Имя',
    'printers.host': 'Хост',
    'printers.port': 'Порт',
    'printers.apiKey': 'API ключ',

    // History
    'history.title': 'История',
    'history.noHistory': 'Нет истории',
    'history.filters': 'Фильтры',
    'history.printer': 'Принтер',
    'history.allPrinters': 'Все принтеры',
    'history.dateFrom': 'От',
    'history.dateTo': 'До',
    'history.noMatches': 'Нет совпадений для выбранных фильтров',

    // Settings
    'settings.title': 'Настройки',
    'settings.notifications': 'Уведомления',
    'settings.pushEnabled': 'Push-уведомления',
    'settings.pushEnable': 'Включить push',
    'settings.pushDisable': 'Выключить push',
    'settings.language': 'Язык',
    'settings.theme': 'Тема',
    'settings.about': 'О приложении',

    // Analytics
    'analytics.title': 'Аналитика',
    'analytics.successRate': 'Успешность',
    'analytics.filamentUsed': 'Филамент',
    'analytics.avgPrintTime': 'Среднее время',
    'analytics.activePrinters': 'Активные принтеры',
    'analytics.printerUsage': 'Использование принтеров',
    'analytics.filamentByPrinter': 'Филамент по принтерам',
    'analytics.prints': 'Печати',
    'analytics.errors': 'Ошибки',

    // Common
    'common.loading': 'Загрузка...',
    'common.error': 'Ошибка',
    'common.success': 'Успешно',
    'common.confirmation': 'Вы уверены?',
    'common.yes': 'Да',
    'common.no': 'Нет',
    'common.cancel': 'Отмена',
    'common.offline': 'Офлайн',
    'common.online': 'Онлайн',
    'common.hours': 'ч',
    'common.minutes': 'м',
    'common.meters': 'м',
    'common.millimeters': 'мм',
  },
};

// Get translation
export function t(key: string, locale: Locale = DEFAULT_LOCALE): string {
  const dict = translations[locale];
  if (!dict) return key;
  return dict[key] ?? key;
}

// Get locale from browser or storage
export function detectLocale(): Locale {
  if (typeof window === 'undefined') return DEFAULT_LOCALE;

  // Check localStorage
  const stored = localStorage.getItem('locale');
  if (stored && LOCALES.includes(stored as Locale)) {
    return stored as Locale;
  }

  // Check browser language
  const browserLang = navigator.language.split('-')[0];
  if (browserLang === 'ru') return 'ru';

  return DEFAULT_LOCALE;
}

// Set locale to storage
export function setLocale(locale: Locale): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem('locale', locale);
}

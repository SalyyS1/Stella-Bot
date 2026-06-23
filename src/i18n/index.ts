import prisma from '../lib/prisma';
import { Locale, TranslationKey, translations } from './translations';

const cache = new Map<string, Locale>();

export function normalizeLocale(locale: string | null | undefined): Locale {
    return locale === 'en' ? 'en' : 'vi';
}

export function localeName(locale: Locale): string {
    return translations[locale]['language.name'];
}

export async function getGuildLocale(guildId?: string | null): Promise<Locale> {
    if (!guildId) return 'vi';
    const cached = cache.get(guildId);
    if (cached) return cached;
    try {
        const settings = await prisma.guildSettings.upsert({
            where: { guildId },
            update: {},
            create: { guildId, locale: 'vi' }
        });
        const locale = normalizeLocale(settings.locale);
        cache.set(guildId, locale);
        return locale;
    } catch (error) {
        console.warn('Guild locale fallback to vi:', error);
        return 'vi';
    }
}

export async function setGuildLocale(guildId: string, locale: Locale): Promise<void> {
    await prisma.guildSettings.upsert({
        where: { guildId },
        update: { locale },
        create: { guildId, locale }
    });
    cache.set(guildId, locale);
}

export function tr(locale: Locale, key: TranslationKey, vars: Record<string, string | number> = {}): string {
    let text = String(translations[locale][key] || translations.vi[key] || key);
    for (const [name, value] of Object.entries(vars)) {
        text = text.split(`{${name}}`).join(String(value));
    }
    return text;
}

export async function t(guildId: string | null | undefined, key: TranslationKey, vars: Record<string, string | number> = {}): Promise<string> {
    const locale = await getGuildLocale(guildId);
    return tr(locale, key, vars);
}

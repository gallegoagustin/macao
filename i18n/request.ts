import { cookies, headers } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { LOCALE_COOKIE, defaultLocale, isLocale, matchAcceptLanguage } from './config';

/** Idioma de la petición: cookie → Accept-Language → español. Sin prefijo en la URL. */
export default getRequestConfig(async () => {
  const fromCookie = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(fromCookie)
    ? fromCookie
    : (matchAcceptLanguage((await headers()).get('accept-language')) ?? defaultLocale);
  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default
  };
});

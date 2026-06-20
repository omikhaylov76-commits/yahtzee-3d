/**
 * Контракт провайдера входа (2.3.b, ADR-0008/0011). Платформа знает только этот интерфейс — конкретный
 * провайдер (Google) инъецируется в композиционном корне. Позже можно добавить другие провайдеры
 * (или mock в тестах), не трогая маршруты/слой аккаунтов.
 */

/** Проверенные данные пользователя от провайдера (после обмена одноразовым кодом). */
export interface AuthUserInfo {
  provider: string; // напр. 'google'
  externalId: string; // стабильный id у провайдера (для Google — `sub`)
  email: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface AuthProvider {
  /** Идентификатор провайдера; используется и в путях маршрутов (`/auth/<id>/start`). */
  readonly id: string;
  /** URL провайдера, куда отправляем пользователя (с нашим `state` для защиты от CSRF). */
  getAuthUrl(state: string): string;
  /** Обменять одноразовый код на ПРОВЕРЕННЫЕ данные пользователя. Бросает при невалидном коде/токене. */
  exchangeCode(code: string): Promise<AuthUserInfo>;
}

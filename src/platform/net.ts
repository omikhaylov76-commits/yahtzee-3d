/**
 * Клиентский сетевой слой платформы. Владелец «онлайн-сессии» (2.1.d-1): создаёт сокет к
 * авторитетному серверу, передаёт версию протокола в рукопожатии (ADR-0013), конструирует
 * `NetworkTransport` и агрегирует статус соединения/комнаты для экрана соединения.
 *
 * Статус собирается из ДВУХ источников на одном сокете: события сокета (connect/connect_error/
 * disconnect/protocol:mismatch) и события комнаты (room:joined/room:full/room:not-found). Транспорт
 * слушает те же `state`/`joined` для своих нужд — socket.io допускает несколько слушателей.
 */
import { io } from 'socket.io-client';
import { MSG, PROTOCOL_VERSION } from '../../shared/protocol';
import { NetworkTransport } from '../transport/NetworkTransport';
import type { Transport } from '../transport/Transport';

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3001';

/**
 * Статус онлайн-сессии для экрана соединения (2.1.d-1):
 * - `connecting` — устанавливаем соединение;
 * - `offline` — сервер недоступен (connect_error);
 * - `mismatch` — версия протокола не совпала, нужен refresh (без ретраев);
 * - `waiting` — вошли в комнату, ждём соперника (партия ещё не началась);
 * - `full` — комната занята (2/2 в 2.1);
 * - `playing` — пришло первое состояние, идёт партия (роутер покажет GameScreen).
 */
export type OnlineStatus = 'connecting' | 'offline' | 'mismatch' | 'waiting' | 'full' | 'playing';

export interface OnlineSession {
  /**
   * Сетевой транспорт поверх этого сокета (подставляется в gameStore вместо локального). Тип —
   * общий `Transport`: стор в 2.1.d-1 не использует сетевых методов (`pending`/`playerId` — 2.1.d-2),
   * а это позволяет подменять сессию фейком в тестах свапа.
   */
  transport: Transport;
  /** Завершить сессию: отключить сокет и обнулить транспорт (вызывается при выходе в меню). */
  dispose: () => void;
}

/**
 * Создать онлайн-сессию: подключиться к серверу, начать слать статус в `onStatus`, отдать
 * транспорт для подмены в сторе. `transport` сам шлёт `room:join` в конструкторе (2.1.c).
 */
export function createOnlineSession(onStatus: (status: OnlineStatus) => void): OnlineSession {
  const socket = io(SERVER_URL, { auth: { protocolVersion: PROTOCOL_VERSION } });
  // mismatch/full — «липкие»: достигнув их, не перетираем статусом сокета (connecting/connected).
  let terminal = false;

  onStatus('connecting');

  socket.on('connect', () => {
    if (!terminal) onStatus('waiting'); // подключились; до joined ждём посадку, после — соперника
  });
  socket.on('connect_error', () => {
    if (!terminal) onStatus('offline');
  });
  socket.on('disconnect', () => {
    if (!terminal) onStatus('connecting'); // socket.io сам переподключается
  });
  socket.on('protocol:mismatch', () => {
    terminal = true;
    onStatus('mismatch');
    socket.close();
  });

  // События комнаты (имена — из общего MSG).
  socket.on(MSG.joined, () => {
    if (!terminal) onStatus('waiting');
  });
  socket.on(MSG.full, () => {
    terminal = true;
    onStatus('full');
    socket.close(); // войти не сможем — нет смысла держать сокет/реконнект (как при mismatch)
  });
  socket.on(MSG.state, () => {
    if (!terminal) onStatus('playing'); // пришло авторитетное состояние — партия пошла
  });
  // room:not-found в 2.1 недостижим (комната `dev` авто-создаётся); продуктовые состояния — 2.2.d.

  const transport = new NetworkTransport(socket);

  return {
    transport,
    dispose: () => {
      terminal = true; // глушим поздние статус-эмиты (disconnect-хендлер после teardown — не 'connecting')
      transport.reset(); // reset() отключает сокет и помечает транспорт мёртвым (2.1.c)
    },
  };
}

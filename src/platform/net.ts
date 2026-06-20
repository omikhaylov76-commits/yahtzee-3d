/**
 * Клиентский сетевой слой платформы. Владелец «онлайн-сессии» (2.1.d-1 → 2.2.a-2): создаёт сокет к
 * авторитетному серверу, передаёт версию протокола в рукопожатии (ADR-0013), конструирует
 * `NetworkTransport` по намерению входа (create/join по коду) и агрегирует статус соединения/комнаты,
 * состав лобби и факт посадки для экранов входа и лобби.
 *
 * Статус собирается из ДВУХ источников на одном сокете: события сокета (connect/connect_error/
 * disconnect/protocol:mismatch) и события комнаты (joined/lobby/full/not-found/already-started/state).
 * Транспорт слушает те же `state`/`joined` для своих нужд — socket.io допускает несколько слушателей.
 */
import { io } from 'socket.io-client';
import {
  MSG,
  PROTOCOL_VERSION,
  type JoinedPayload,
  type LobbyPayload,
} from '../../shared/protocol';
import { NetworkTransport, type OnlineIntent } from '../transport/NetworkTransport';
import type { Transport } from '../transport/Transport';
import { joinedSchema, lobbySchema, presenceSchema } from '../../shared/schemas';

// Адрес сервера платформы. В ПРОДЕ клиент раздаётся тем же сервером (same-origin, 2.P.1) → URL не нужен:
// socket.io берёт origin страницы. В DEV клиент на Vite :5173, сервер на :3001 → явный localhost. Пустую
// строку из `.env` (`VITE_SERVER_URL=`) трактуем как «не задано» (аудит m2: `??` её бы не отсёк).
const ENV_URL = import.meta.env.VITE_SERVER_URL?.trim();
const SERVER_URL = ENV_URL || (import.meta.env.DEV ? 'http://localhost:3001' : undefined);

/**
 * Статус онлайн-сессии для экранов входа/лобби (2.2.a-2):
 * - `connecting` — устанавливаем соединение / создаём-входим (до посадки);
 * - `offline` — сервер недоступен (connect_error);
 * - `mismatch` — версия протокола не совпала, нужен refresh (без ретраев);
 * - `notFound` — комната по коду не найдена (вход);
 * - `full` — комната заполнена (4/4);
 * - `serverBusy` — сервер перегружен (cap комнат на процесс): create не удался (a-1: full с пустым roomId);
 * - `alreadyStarted` — партия в этой комнате уже идёт (код больше не пускает);
 * - `kicked` — хозяин выгнал нас из лобби (2.2.c-1) — терминально, назад на экран входа;
 * - `waiting` — мы в комнате (лобби), ждём игроков/старта;
 * - `playing` — пришло первое состояние, идёт партия (роутер покажет GameScreen).
 */
export type OnlineStatus =
  | 'connecting'
  | 'offline'
  | 'mismatch'
  | 'notFound'
  | 'full'
  | 'serverBusy'
  | 'alreadyStarted'
  | 'kicked'
  | 'waiting'
  | 'playing';

/** Колбэки сессии в стор: статус, состав лобби (до старта) и подтверждение посадки. */
export interface OnlineCallbacks {
  onStatus: (status: OnlineStatus) => void;
  onLobby: (lobby: LobbyPayload) => void;
  onJoined: (joined: JoinedPayload) => void;
  /** Присутствие в идущей партии (2.2.d-2): playerId с живым сокетом. Оставшийся один → баннер «opponent left». */
  onPresence: (connected: string[]) => void;
  /** Залогинен без ника (2.3.e-2b): сервер отказал во входе в комнату → увести на онбординг ника. */
  onNicknameRequired: () => void;
}

export interface OnlineSession {
  /** Сетевой транспорт поверх этого сокета (подставляется в gameStore вместо локального). */
  transport: Transport;
  /** Запустить партию (только хозяин; сервер проверяет роль). Сессионное действие, не игровое. */
  start: () => void;
  /** Выгнать игрока из лобби по индексу места (только хозяин; сервер проверяет роль). Сессионное (2.2.c-1). */
  kick: (seat: number) => void;
  /** Завершить сессию: отключить сокет и обнулить транспорт (вызывается при выходе в меню). */
  dispose: () => void;
}

/**
 * Создать онлайн-сессию по намерению `intent` (создать комнату или войти по коду): подключиться к
 * серверу, слать статус/лобби/посадку в колбэки, отдать транспорт для подмены в сторе. Сам вход
 * (`create`/`join`) и reclaim на (ре)коннект делает `transport` в своём `connect`-обработчике.
 */
export function createOnlineSession(intent: OnlineIntent, cb: OnlineCallbacks): OnlineSession {
  // same-origin в проде (SERVER_URL undefined → io без URL берёт origin страницы); явный URL в dev.
  // withCredentials — чтобы cookie сессии уехала в рукопожатие (2.3.c-3): сервер опознаёт залогиненного.
  const socket = SERVER_URL
    ? io(SERVER_URL, { auth: { protocolVersion: PROTOCOL_VERSION }, withCredentials: true })
    : io({ auth: { protocolVersion: PROTOCOL_VERSION }, withCredentials: true });
  // mismatch/full/notFound/alreadyStarted — «терминальные»: достигнув их, не перетираем статусом сокета.
  let terminal = false;

  cb.onStatus('connecting');

  socket.on('connect', () => {
    if (!terminal) cb.onStatus('connecting'); // подключились; до joined мы ещё «входим»
  });
  socket.on('connect_error', () => {
    if (!terminal) cb.onStatus('offline');
  });
  socket.on('disconnect', () => {
    if (!terminal) cb.onStatus('connecting'); // socket.io сам переподключается
  });
  socket.on('protocol:mismatch', () => {
    terminal = true;
    cb.onStatus('mismatch');
    socket.close();
  });

  // События комнаты (имена — из общего MSG).
  socket.on(MSG.joined, (p) => {
    if (terminal) return;
    const v = joinedSchema.safeParse(p);
    if (!v.success) return; // невалидный конверт (2.3.c-4) — игнор
    cb.onJoined(v.data);
    cb.onStatus('waiting'); // сели в комнату — ждём в лобби (старт/игроков)
  });
  socket.on(MSG.lobby, (p) => {
    if (terminal) return;
    const v = lobbySchema.safeParse(p);
    if (v.success) cb.onLobby(v.data);
  });
  // Сервер шлёт full с пустым roomId при перегрузке (cap комнат, a-1) — различаем «занято» и «перегружен».
  socket.on(MSG.full, (p) => closeWith((p as { roomId?: string })?.roomId ? 'full' : 'serverBusy'));
  socket.on(MSG.notFound, () => closeWith('notFound'));
  socket.on(MSG.alreadyStarted, () => closeWith('alreadyStarted'));
  socket.on(MSG.kicked, () => closeWith('kicked')); // хозяин выгнал — терминально (2.2.c-1)
  socket.on(MSG.state, () => {
    if (!terminal) cb.onStatus('playing'); // пришло авторитетное состояние — партия пошла
  });
  socket.on(MSG.presence, (p) => {
    // Присутствие идущей партии (2.2.d-2): кто ещё на связи. Оставшийся один → баннер (логика — в сторе).
    if (terminal) return;
    const v = presenceSchema.safeParse(p);
    if (v.success) cb.onPresence(v.data.connected);
  });
  // Залогинен без ника (2.3.e-2b): вход в комнату отклонён сервером. Терминально для этой попытки —
  // стор погасит мёртвую сессию и уведёт на онбординг ника. Payload нет — схема не нужна.
  socket.on(MSG.nicknameRequired, () => {
    terminal = true;
    cb.onNicknameRequired();
    socket.close();
  });

  /** Терминальный отказ входа: фиксируем статус и закрываем сокет (войти не сможем — нет смысла держать). */
  function closeWith(status: OnlineStatus): void {
    terminal = true;
    cb.onStatus(status);
    socket.close();
  }

  const transport = new NetworkTransport(socket, intent);

  return {
    transport,
    start: () => socket.emit(MSG.start),
    kick: (seat) => socket.emit(MSG.kick, { seat }),
    dispose: () => {
      terminal = true; // глушим поздние статус-эмиты (disconnect-хендлер после teardown — не 'connecting')
      transport.reset(); // reset() отключает сокет и помечает транспорт мёртвым (2.1.c)
    },
  };
}

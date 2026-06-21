/**
 * Мост между Transport (ядро игры) и React (F2.3). Тонкий слой: НЕ содержит правил —
 * только хранит последнее состояние/события и проксирует действия в transport.
 * Это держит границы (architecture.md): ядро не знает про React, React не знает про reduce.
 */
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { Category, DomainEvent, GameState } from '../core';
import type { Transport } from '../transport/Transport';
import { LocalTransport } from '../transport/LocalTransport';
import { LocalStorageGameStorage } from '../storage/localStorageGameStorage';
import {
  createOnlineSession,
  type OnlineCallbacks,
  type OnlineSession,
  type OnlineStatus,
} from '../platform/net';
import type { OnlineIntent } from '../transport/NetworkTransport';
import type { LobbyPayload } from '../../shared/protocol';
import { uiStore } from './uiStore';

export interface GameStoreState {
  /** Текущее состояние партии (null — игра не начата). */
  state: GameState | null;
  /** События последнего действия (для звука/сочности в F5+). */
  events: DomainEvent[];
  /**
   * Кости летят (физический бросок ещё не успокоился) — флаг слоя render3d, НЕ ядра.
   * Пока true, UI блокирует Roll/контролы; снимается, когда 3D эмитит «успокоились»
   * (architecture.md: dice:settled — событие render3d).
   */
  settling: boolean;
  /** Слой render3d выставляет/снимает флаг полёта костей. */
  setSettling: (settling: boolean) => void;
  /**
   * Счётчик «потрясти стол» (Nudge) — косметический толчок костей, НЕ Action ядра и НЕ меняет
   * значения (честность/сеть). Растёт на каждое нажатие; render3d реагирует на изменение.
   */
  nudgeNonce: number;
  /** UI зовёт, чтобы «вздрогнул стол» — кости подпрыгнут и доваляются на те же значения. */
  nudge: () => void;
  /** Настройки звука (F5): выключен ли звук и громкость 0..1. Сохраняются в localStorage. */
  muted: boolean;
  volume: number;
  /** Включён ли фоновый эмбиент (F5.2). Сохраняется в localStorage. */
  ambient: boolean;
  setMuted: (muted: boolean) => void;
  setVolume: (volume: number) => void;
  setAmbient: (ambient: boolean) => void;
  newGame: (players: { name: string }[]) => void;
  roll: () => void;
  toggleHold: (index: number) => void;
  score: (category: Category) => void;
  reset: () => void;
  /**
   * Режим активного транспорта (2.1.d-1). `local` — `LocalTransport` (hotseat/соло, автосейв);
   * `online` — `NetworkTransport` поверх сокета. UI-экраны режим не знают (ADR-0003).
   */
  mode: 'local' | 'online';
  /** Статус сетевой сессии для экрана соединения; null вне онлайна. */
  onlineStatus: OnlineStatus | null;
  /**
   * Стабильный id ЭТОГО клиента в сетевой партии (выдан сервером при входе); null в local или до
   * входа. UI гейтит «мой ход» по нему (2.1.d-3). Зеркалится с активного сетевого транспорта.
   */
  myPlayerId: string | null;
  /**
   * Сетевое действие «в полёте» — отправлено, ждём авторитетный ответ сервера (ADR-0013). Пока true,
   * UI блокирует контролы (анти-двойной Roll/Score). Всегда false в local-режиме (2.1.d-3).
   */
  pending: boolean;
  /** Состав комнаты ДО старта (2.2.a-2): пока не null и партии нет — роутер показывает лобби. */
  lobby: LobbyPayload | null;
  /** Моё место в комнате (из `joined`); по нему помечаем «you» в лобби. null вне онлайна. */
  mySeat: number | null;
  /** Я ли хозяин комнаты (создатель): только хозяин видит активную кнопку Start. */
  isHost: boolean;
  /** Старт по готовности (open/persistent) vs host-Start (приватная) — из intent в goOnline (2.5.d). */
  readyUp: boolean;
  /** Код текущей онлайн-комнаты (для шаринга в лобби); null вне онлайна. */
  roomCode: string | null;
  /**
   * Присутствие в идущей сетевой партии (2.2.d-2): playerId с живым сокетом (из `room:presence`). null вне
   * онлайна/до первого presence. Если в списке нет НИКОГО, кроме `myPlayerId` → соперник вышел (баннер).
   */
  connectedIds: string[] | null;
  /** Войти в онлайн по намерению (создать комнату / войти по коду): подменить транспорт сетевым. */
  goOnline: (intent: OnlineIntent) => void;
  /** Хозяин запускает партию из лобби (сервер проверяет роль и ≥2 игроков). */
  startGameOnline: () => void;
  /** Хозяин выгоняет игрока из лобби по индексу места (2.2.c-1); сервер проверяет роль. */
  kickPlayer: (seat: number) => void;
  /** Тоггл своей готовности (2.5.b, ready-up в open/persistent). Сервер стартует, когда все готовы. */
  setReady: (ready: boolean) => void;
  /** Реванш в открытом/дежурном столе после партии (2.5.d-3b): сброс стола в лобби + я сразу готов. */
  playAgain: () => void;
  /** Выйти из онлайна: отключить сетевой транспорт, вернуться на сохранённый локальный. */
  goLocal: () => void;
}

/**
 * Узкий «сетевой» подмешок транспорта (его реализует `NetworkTransport`, но НЕ `LocalTransport`):
 * стор читает эти геттеры duck-typing'ом, не расширяя общий контракт `Transport` (2.1.d-3).
 */
interface NetworkAware {
  getPlayerId(): string | null;
  getPending(): boolean;
}

function isNetworkAware(t: unknown): t is NetworkAware {
  const c = t as Partial<NetworkAware>;
  return typeof c.getPlayerId === 'function' && typeof c.getPending === 'function';
}

const SOUND_KEY = 'yahtzee.sound.v1';

interface SoundSettings {
  muted: boolean;
  volume: number;
  ambient: boolean;
}

/** Прочитать настройки звука из localStorage (с безопасными значениями по умолчанию). */
function loadSound(): SoundSettings {
  try {
    const raw = localStorage.getItem(SOUND_KEY);
    if (raw) {
      const v = JSON.parse(raw) as Partial<SoundSettings>;
      return {
        muted: !!v.muted,
        volume: typeof v.volume === 'number' ? Math.max(0, Math.min(1, v.volume)) : 0.6,
        ambient: !!v.ambient,
      };
    }
  } catch {
    // повреждённые/недоступные данные — дефолт
  }
  return { muted: false, volume: 0.6, ambient: false };
}

function saveSound(s: SoundSettings): void {
  try {
    localStorage.setItem(SOUND_KEY, JSON.stringify(s));
  } catch {
    // localStorage недоступен — настройки живут в памяти сессии
  }
}

/**
 * Собрать стор поверх произвольного транспорта (используется и в тестах с MemoryStorage).
 * `makeOnlineSession` — фабрика онлайн-сессии; по умолчанию реальная (сокет+`NetworkTransport`),
 * в тестах подменяется фейком, чтобы проверить свап транспорта без сети (как инъекция сокета в 2.1.c).
 */
export function createGameStore(
  localTransport: Transport,
  makeOnlineSession: (
    intent: OnlineIntent,
    cb: OnlineCallbacks,
  ) => OnlineSession = createOnlineSession,
): StoreApi<GameStoreState> {
  const sound = loadSound();

  // Активный транспорт можно подменять (local↔online, 2.1.d-1). Методы стора читают `active` в
  // момент вызова, поэтому свап прозрачен для UI. `localTransport` живёт всё время (его автосейв
  // не теряется при заходе в онлайн); сетевой транспорт создаётся на сессию.
  let active: Transport = localTransport;
  let session: OnlineSession | null = null;
  let unsub: () => void = () => {};

  const store = createStore<GameStoreState>((set, get) => ({
    state: active.getState(),
    events: [],
    settling: false,
    setSettling: (settling) => set({ settling }),
    nudgeNonce: 0,
    nudge: () => set((s) => ({ nudgeNonce: s.nudgeNonce + 1 })),
    muted: sound.muted,
    volume: sound.volume,
    ambient: sound.ambient,
    setMuted: (muted) => {
      set({ muted });
      saveSound({ muted, volume: get().volume, ambient: get().ambient });
    },
    setVolume: (volume) => {
      const v = Math.max(0, Math.min(1, volume));
      set({ volume: v });
      saveSound({ muted: get().muted, volume: v, ambient: get().ambient });
    },
    setAmbient: (ambient) => {
      set({ ambient });
      saveSound({ muted: get().muted, volume: get().volume, ambient });
    },
    newGame: (players) => active.dispatch({ type: 'NEW_GAME', players }),
    // После dispatch зеркалим сетевой `pending` (он синхронно встаёт в true), чтобы UI сразу
    // заблокировал контролы; снимется обратно в колбэке подписки при приходе состояния/denied (2.1.d-3).
    roll: () => {
      active.dispatch({ type: 'ROLL' });
      mirrorNet();
    },
    toggleHold: (index) => {
      active.dispatch({ type: 'TOGGLE_HOLD', index });
      mirrorNet();
    },
    score: (category) => {
      active.dispatch({ type: 'SCORE', category });
      mirrorNet();
    },
    reset: () => {
      // В онлайне «сброс/выход в меню» = разорвать сетевую сессию и вернуться в локальный режим
      // (локальную партию/автосейв НЕ трогаем — они не были активны). Иначе `mode` залип бы в
      // 'online' с мёртвым транспортом: повторный онлайн и последующая локальная игра сломались бы.
      if (get().mode === 'online') get().goLocal();
      else active.reset();
    },
    mode: 'local',
    onlineStatus: null,
    myPlayerId: null,
    pending: false,
    lobby: null,
    mySeat: null,
    isHost: false,
    readyUp: false,
    roomCode: null,
    connectedIds: null,
    goOnline: (intent) => {
      if (get().mode === 'online') return; // уже онлайн — повторный заход игнорируем
      session = makeOnlineSession(intent, {
        onStatus: (onlineStatus) =>
          // 'kicked' терминален и приходит, пока мы в лобби: гасим `lobby`, чтобы роутер увёл из
          // LobbyScreen на OnlineScreen со статусом (там покажется «хозяин удалил вас»). (2.2.c-1)
          store.setState(
            onlineStatus === 'kicked' ? { onlineStatus, lobby: null } : { onlineStatus },
          ),
        onLobby: (lobby) => store.setState({ lobby }),
        onPresence: (connected) => store.setState({ connectedIds: connected }), // 2.2.d-2: «остался один»
        // Стол вернулся в лобби после партии (ADR-0016, реванш): из игры обратно в ожидание; чистим
        // присутствие (иначе ложный «opponent left» мигнёт в следующей партии). Состояние игры гасит
        // транспорт (emit null) → подписка выставит state=null; роутер покажет лобби (2.5.a-2).
        onReset: () => store.setState({ onlineStatus: 'waiting', connectedIds: null }),
        onJoined: (j) =>
          store.setState({
            myPlayerId: j.playerId,
            mySeat: j.seat,
            isHost: j.isHost,
            roomCode: j.roomId,
          }),
        // Залогинен без ника (2.3.e-3b safety net): гасим мёртвую онлайн-сессию и ведём на онбординг
        // (вернёмся в online). Проактивный гейт в OnlineScreen обычно не доводит сюда — это страховка.
        onNicknameRequired: () => {
          get().goLocal();
          uiStore.getState().setNicknameReturn('online');
          uiStore.getState().setView('nickname');
        },
      });
      switchTo(session.transport);
      set({
        mode: 'online',
        onlineStatus: 'connecting',
        // Старт по готовности — для открытого/дежурного стола (joinOpen или create с open); приватная — host-Start.
        readyUp: intent.type === 'joinOpen' || (intent.type === 'create' && intent.open === true),
        lobby: null,
        mySeat: null,
        isHost: false,
        roomCode: null,
        connectedIds: null,
      });
    },
    startGameOnline: () => {
      session?.start();
    },
    kickPlayer: (seat) => {
      session?.kick(seat);
    },
    setReady: (ready) => {
      session?.setReady(ready);
    },
    playAgain: () => {
      session?.playAgain();
    },
    goLocal: () => {
      if (get().mode === 'local') return;
      session?.dispose(); // отключить сокет + обнулить сетевой транспорт (2.1.c reset)
      session = null;
      // Возврат на локальный транспорт. ИНВАРИАНТ (важно для «выхода в меню», 2.1.d-2): онлайн
      // достижим ТОЛЬКО из меню, а меню роутер показывает лишь при `state===null` (App.tsx:
      // `state ? Game : view`). Значит пока мы онлайн, `localTransport` гарантированно пуст —
      // `getState()` здесь вернёт null, и «выход из онлайна» приведёт в меню, а не воскресит чужую
      // локальную партию. (Если инвариант когда-то ослабнет — пересмотреть этот путь.)
      switchTo(localTransport);
      set({
        mode: 'local',
        onlineStatus: null,
        lobby: null,
        mySeat: null,
        isHost: false,
        readyUp: false,
        roomCode: null,
        connectedIds: null,
      });
    },
  }));

  // Зеркалим «сетевые» поля (мой id места + действие в полёте) с активного транспорта. В local
  // (или до входа) геттеров нет — поля сбрасываются в null/false, и гейтинг ввода выключен (2.1.d-3).
  function mirrorNet(): void {
    if (store.getState().mode === 'online' && isNetworkAware(active)) {
      store.setState({ myPlayerId: active.getPlayerId(), pending: active.getPending() });
    } else {
      store.setState({ myPlayerId: null, pending: false });
    }
  }

  // Зеркалим обновления АКТИВНОГО транспорта в стор; при свапе переподписываемся и сразу
  // показываем текущее состояние нового транспорта (события сбрасываем — это не игровое действие).
  function switchTo(next: Transport): void {
    unsub();
    active = next;
    unsub = active.subscribe((state, events) => {
      store.setState({ state, events });
      mirrorNet(); // приход авторитетного состояния/denied снимает pending, обновляет playerId
    });
    store.setState({ state: active.getState(), events: [] });
    mirrorNet();
  }
  unsub = active.subscribe((state, events) => {
    store.setState({ state, events });
    mirrorNet();
  });

  return store;
}

/** Дефолтный транспорт приложения: локальный + автосохранение в localStorage. */
const defaultTransport = new LocalTransport(new LocalStorageGameStorage());

/** Глобальный стор игры для React-приложения. */
export const gameStore = createGameStore(defaultTransport);

/** Хук для React-компонентов: подписка на срез стора. */
export function useGameStore<T>(selector: (s: GameStoreState) => T): T {
  return useStore(gameStore, selector);
}

/** Чей сейчас ход — это id ЭТОГО клиента (только в сети; в local понятие неприменимо). */
function isMyTurn(s: GameStoreState): boolean {
  const st = s.state;
  if (!st || s.myPlayerId == null) return false;
  return st.players[st.current]?.id === s.myPlayerId;
}

/**
 * Заблокирован ли пользовательский ввод (контролы Roll/Nudge/hold и запись очков). В сети — когда
 * нет живой партии (соединение/ожидание), действие в полёте (`pending`) или ход соперника. В local
 * всегда false — поведение Вехи 1 без изменений (2.1.d-3). Чистая функция: тестируется без React.
 */
export function selectInputLocked(s: GameStoreState): boolean {
  if (s.mode !== 'online') return false;
  if (s.onlineStatus !== 'playing') return true; // нет авторитетной партии (разрыв/ожидание)
  if (s.pending) return true; // ждём ответ сервера на наше действие
  return !isMyTurn(s);
}

/**
 * Текст баннера-подсказки для сетевой партии (или null — баннера нет). Приоритет: нет соединения →
 * ход соперника. `pending` баннера не показывает (краткий — достаточно блокировки кнопок) (2.1.d-3).
 */
export function selectTurnBanner(s: GameStoreState): string | null {
  if (s.mode !== 'online') return null;
  if (s.onlineStatus !== 'playing') return 'Connection lost — reconnecting…';
  // Пока сервер не сообщил наше место (`myPlayerId == null`), не утверждаем «ход соперника» — это
  // могло бы соврать в короткое окно реконнекта (2.1.e). Ввод всё равно заблокирован (fail-safe).
  if (s.myPlayerId == null || !s.state) return null;
  // Остался один (2.2.d-2): сервер прислал присутствие идущей партии, и в нём нет НИКОГО, кроме меня —
  // соперник вышел. Партия не завершена штатно (over → WinnerScreen). Приоритет ниже «Connection lost»
  // (там упало МОЁ соединение), выше «Opponent's turn». Без forfeit (авто-победа/таймеры — 2.4.c).
  if (
    s.state.phase !== 'over' &&
    s.connectedIds != null &&
    !s.connectedIds.some((id) => id !== s.myPlayerId)
  ) {
    return 'Your opponent left the game.';
  }
  return isMyTurn(s) ? null : "Opponent's turn";
}

/** Хук: заблокирован ли ввод (см. `selectInputLocked`). Зовут `GameScreen` и `ScoreTable`. */
export function useInputLocked(): boolean {
  return useStore(gameStore, selectInputLocked);
}

/** Хук: текст баннера сетевой партии или null (см. `selectTurnBanner`). */
export function useTurnBanner(): string | null {
  return useStore(gameStore, selectTurnBanner);
}

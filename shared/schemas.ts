/**
 * Рантайм-схемы сетевых сообщений (2.3.c-4, zod v4). Валидация на границах: сервер проверяет входящее
 * от НЕдоверенного клиента (безопасность — закрывает хвосты 2.1/2.2: диапазон index, длина actionId,
 * слепой каст), клиент — оболочку входящего от сервера (хвост 2.1). Типы живут в protocol.ts; схемы —
 * рантайм-страховка структуры (глубину PublicGameState доверяем СВОЕМУ авторитетному серверу).
 */
import { z } from 'zod';

const DICE_COUNT = 5;

// --- от клиента НА СЕРВЕР (строго: клиент недоверенный) ---
export const createReqSchema = z.object({
  name: z.string().optional(),
  open: z.boolean().optional(),
  title: z.string().max(100).optional(),
});
export const joinReqSchema = z.object({
  roomId: z.string(),
  name: z.string().optional(),
  playerId: z.string().optional(),
});
export const joinOpenReqSchema = z.object({
  tableId: z.string(),
  name: z.string().optional(),
  playerId: z.string().optional(),
});
export const kickReqSchema = z.object({ seat: z.number().int() });
export const readyReqSchema = z.object({ ready: z.boolean() });
// Тело смены ника (2.3.e-2a, HTTP). Защита от мусора/размера; настоящая валидация (длина/невидимки/
// резерв/уникальность) — в setNickname/isValidNickname на сервере.
export const nicknameBodySchema = z.object({ nickname: z.string().max(100) });

export const networkActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ROLL') }),
  z.object({
    type: z.literal('TOGGLE_HOLD'),
    index: z
      .number()
      .int()
      .min(0)
      .max(DICE_COUNT - 1),
  }),
  z.object({ type: z.literal('SCORE'), category: z.string().min(1).max(40) }),
]);
export const actionMsgSchema = z.object({
  action: networkActionSchema,
  actionId: z.string().min(1).max(128),
});

// --- от сервера НА КЛИЕНТ (оболочка; глубину публичного состояния доверяем своему серверу) ---
export const joinedSchema = z.object({
  roomId: z.string(),
  playerId: z.string(),
  seat: z.number().int(),
  isHost: z.boolean(),
});
export const lobbySchema = z.object({
  roomId: z.string(),
  players: z.array(
    z.object({
      seat: z.number().int(),
      name: z.string(),
      isHost: z.boolean(),
      ready: z.boolean(),
    }),
  ),
  capacity: z.number().int(),
  canStart: z.boolean(),
});
export const presenceSchema = z.object({ connected: z.array(z.string()) });
export const resetSchema = z.object({ roomId: z.string() });
export const deniedSchema = z.object({ reason: z.string(), actionId: z.string().optional() });
export const stateSchema = z.object({
  stateVersion: z.number().int(),
  state: z.record(z.string(), z.unknown()),
  events: z.array(z.unknown()),
});

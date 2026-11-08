// Классификатор touch-свайпов (2026-11-08-mobile-messenger-ux): чистая
// функция без DOM — компоненты вешают touchstart/touchend через events
// Block и скармливают сюда конечные точки. Пороги подобраны под палец:
// короткий тап и скролл ленты не классифицируются (доминантность оси).

export const SWIPE_MIN_DISTANCE_PX = 50

// Горизонтальный жест обязан доминировать над вертикалью (и наоборот),
// иначе скролл ленты сообщений время от времени «превращался» бы в
// возврат к списку чатов
export const SWIPE_AXIS_DOMINANCE = 1.5

export interface SwipePoint {
    x: number
    y: number
}

export type SwipeDirection = 'left' | 'right' | 'down'

// Направление жеста по паре точек: 'right' — вправо (возврат), 'left' —
// влево (дальше), 'down' — вниз (закрыть); null — жест не состоялся
export function resolveSwipe(start: SwipePoint, end: SwipePoint): SwipeDirection | null {
    const dx = end.x - start.x
    const dy = end.y - start.y

    if (Math.abs(dx) >= SWIPE_MIN_DISTANCE_PX && Math.abs(dx) > Math.abs(dy) * SWIPE_AXIS_DOMINANCE) {
        return dx > 0 ? 'right' : 'left'
    }

    if (dy >= SWIPE_MIN_DISTANCE_PX && dy > Math.abs(dx) * SWIPE_AXIS_DOMINANCE) {
        return 'down'
    }

    return null
}

// Классификатор свайпов (2026-11-08-mobile-messenger-ux): пороги,
// доминантность оси и отрицательные случаи — короткий тап и диагональ
// не классифицируются, вертикальный скролл ленты не становится «возвратом»

import { expect } from 'chai'
import { resolveSwipe, SWIPE_AXIS_DOMINANCE, SWIPE_MIN_DISTANCE_PX } from './swipe.ts'

describe('swipe classifier', () => {
    it('classifies a dominant right swipe', () => {
        expect(resolveSwipe({ x: 0, y: 0 }, { x: 120, y: 10 })).to.eq('right')
    })

    it('classifies a dominant left swipe', () => {
        expect(resolveSwipe({ x: 120, y: 0 }, { x: 0, y: 5 })).to.eq('left')
    })

    it('classifies a dominant down swipe', () => {
        expect(resolveSwipe({ x: 0, y: 0 }, { x: 5, y: 130 })).to.eq('down')
    })

    it('keeps an up swipe unclassified', () => {
        expect(resolveSwipe({ x: 0, y: 130 }, { x: 0, y: 0 })).to.eq(null)
    })

    it('rejects a short tap under the distance threshold', () => {
        expect(resolveSwipe({ x: 0, y: 0 }, { x: SWIPE_MIN_DISTANCE_PX - 1, y: 0 })).to.eq(null)
    })

    it('accepts the exact threshold distance', () => {
        expect(resolveSwipe({ x: 0, y: 0 }, { x: SWIPE_MIN_DISTANCE_PX, y: 0 })).to.eq('right')
    })

    it('rejects a diagonal drag without axis dominance', () => {
        // dx == dy: ни одна ось не доминирует в SWIPE_AXIS_DOMINANCE раз
        expect(resolveSwipe({ x: 0, y: 0 }, { x: 100, y: 100 })).to.eq(null)
        expect(resolveSwipe({ x: 0, y: 0 }, { x: 100, y: 100 / SWIPE_AXIS_DOMINANCE + 1 })).to.eq(null)
    })

    it('accepts a horizontal swipe whose vertical drift stays under the dominance ratio', () => {
        expect(resolveSwipe({ x: 0, y: 0 }, { x: 100, y: Math.floor(100 / SWIPE_AXIS_DOMINANCE) - 1 })).to.eq('right')
    })

    it('rejects a down swipe whose horizontal drift breaks dominance', () => {
        expect(resolveSwipe({ x: 0, y: 0 }, { x: 90, y: 100 })).to.eq(null)
    })
})

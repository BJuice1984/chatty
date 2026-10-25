import { expect } from 'chai'
import { STORY_TTL_MS, isStoryAlive } from './ttl.ts'

describe('stories TTL', () => {
    const now = Date.parse('2026-10-25T12:00:00Z')

    it('fresh stories stay alive', () => {
        expect(isStoryAlive('2026-10-25T11:59:00Z', now)).to.be.true
        expect(isStoryAlive('2026-10-24T12:00:01Z', now)).to.be.true
    })

    it('stories past the server TTL die out', () => {
        expect(isStoryAlive('2026-10-23T00:00:00Z', now)).to.be.false
        expect(isStoryAlive('2026-10-24T11:59:59Z', now)).to.be.false
    })

    it('the boundary itself is expired (strictly less than TTL)', () => {
        expect(isStoryAlive('2026-10-24T12:00:00Z', now)).to.be.false
        expect(now - Date.parse('2026-10-24T12:00:00Z')).to.eq(STORY_TTL_MS)
    })

    it('an unparseable date is kept — a miss-filter is safer than a hidden ring', () => {
        expect(isStoryAlive('not-a-date', now)).to.be.true
    })
})

// Подсветка поиска: разбор первого вхождения и XSS-безопасный рендер —
// сервер присылает сырые подстроки, каждая часть обязана уйти в HTML
// экранированной, <mark> оборачивает только совпадение.

import { expect } from 'chai'
import { buildHighlightParts, renderHighlighted } from './highlight.ts'

describe('buildHighlightParts', () => {
    it('splits the haystack on the first occurrence', () => {
        expect(buildHighlightParts('Hello brave world', 'brave')).to.deep.equal({
            before: 'Hello ',
            match: 'brave',
            after: ' world',
        })
    })

    it('matches case-insensitively keeping the original casing', () => {
        expect(buildHighlightParts('Проект Chatty', 'chatty')).to.deep.equal({
            before: 'Проект ',
            match: 'Chatty',
            after: '',
        })
    })

    it('takes only the first occurrence', () => {
        expect(buildHighlightParts('ta ta ta', 'ta')).to.deep.equal({
            before: '',
            match: 'ta',
            after: ' ta ta',
        })
    })

    it('returns null for an empty needle', () => {
        expect(buildHighlightParts('что угодно', '')).to.be.null
    })

    it('returns null when there is no match', () => {
        expect(buildHighlightParts('Чatty', 'zzz')).to.be.null
    })
})

describe('renderHighlighted', () => {
    it('wraps only the match into a mark', () => {
        expect(renderHighlighted({ before: 'при', match: 'вет', after: '!' })).to.equal(
            'при<mark>вет</mark>!',
        )
    })

    it('escapes HTML in every part (XSS)', () => {
        const parts = buildHighlightParts('<script>alert(1)</script>', 'alert')

        expect(parts).to.not.be.null

        const html = renderHighlighted(parts as { before: string, match: string, after: string })

        expect(html).to.not.contain('<script')
        expect(html).to.contain('&lt;script&gt;')
        expect(html).to.contain('&lt;/script&gt;')
        expect(html).to.contain('<mark>alert</mark>')
    })
})

import { expect } from 'chai'
import '../hbs-test-loader.ts'
import { DocumentCard } from './document-card.ts'

describe('ai assistant document card rendering', () => {
    it('renders a download link for a valid integer file id', () => {
        const card = new DocumentCard({ fileId: 7, title: 'Заголовок', snippet: 'фрагмент' })
        const link = card.element?.querySelector('a.ai-assistant__document-link')

        expect(link).to.exist
        expect(link?.getAttribute('href')).to.match(/\/files\/7\/download$/)
    })

    it('renders bot-supplied markup as text, never as elements', () => {
        const card = new DocumentCard({
            fileId: 7,
            title: '<b>bold</b>',
            snippet: '<img src=x onerror=alert(1)>',
        })

        expect(card.element?.querySelector('img')).to.not.exist
        expect(card.element?.querySelector('b')).to.not.exist
        expect(card.element?.querySelector('.ai-assistant__document-title')?.innerHTML).to.contain('&lt;b&gt;')
        expect(card.element?.querySelector('.ai-assistant__document-snippet')?.innerHTML).to.contain(
            '&lt;img'
        )
    })

    it('degrades to a link-less card for unsafe file ids', () => {
        const card = new DocumentCard({
            fileId: 'javascript:alert(1)' as unknown,
            title: 'Заголовок',
            snippet: 'фрагмент',
        })

        expect(card.element?.querySelector('a')).to.not.exist
        expect(card.element?.querySelector('.ai-assistant__document-title')?.innerHTML).to.contain(
            'Заголовок'
        )
    })
})

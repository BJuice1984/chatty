// Регрессия LIVE-4: null/пустой src не доходит до fileUrl — контракт ждёт
// строку, null раньше валился на path.trim() и ронял рендер аватара.

import { expect } from 'chai'
import { JSDOM } from 'jsdom'
// Грузим .hbs тестовым погрузчиком раньше импорта компонента (прецедент — ai-assistant)
import '../../../features/ai-assistant/hbs-test-loader.ts'
import { fileUrl } from '../../../utils/env.ts'
import { ChatAvatar } from './chatAvatar.ts'

const dom = new JSDOM()
global.document = dom.window.document

function render(src: string | null | undefined): ChatAvatar {
    return new ChatAvatar({ src: src as string })
}

describe('chat avatar null guard', () => {
    it('renders the placeholder without fileUrl for null and empty src (LIVE-4)', () => {
        for (const src of [null, '', undefined]) {
            const avatar = render(src)

            // Корень рендера — плейсхолдер-див, а не <img>: fileUrl не
            // вызывался, рендер не упал на path.trim() от null
            expect(avatar.element?.tagName, `src=${String(src)}`).to.eq('DIV')
            expect(avatar.element?.querySelector('img')).to.not.exist
            avatar.destroy()
        }
    })

    it('maps a non-empty relative path through fileUrl', () => {
        const avatar = render('avatars/chat-3.png')

        expect(avatar.element?.tagName).to.eq('IMG')
        expect(avatar.element?.getAttribute('src')).to.eq(fileUrl('avatars/chat-3.png'))
        avatar.destroy()
    })

    it('keeps app-static paths starting with a slash as-is', () => {
        // локальные ассеты (public/images/avatars) не прогоняем через filesUrl
        const avatar = render('/images/avatars/3.svg')

        expect(avatar.element?.tagName).to.eq('IMG')
        expect(avatar.element?.getAttribute('src')).to.eq('/images/avatars/3.svg')
        avatar.destroy()
    })
})

// Пузырь сообщения (chat-ui-polish): сторона mine/theirs модификатором на li,
// время ЧЧ:ММ из ISO-метки, маркер дня только по showDate и NaN-безопасность —
// невалидная метка (фикстуры ws гоняют time вида 't'+id) рендерится без
// времени и маркера и не кидает RangeError из Intl.
// hbs-шаблон грузится тестовым погрузчиком (прецедент — ai-assistant).

import { expect } from 'chai'
import sinon from 'sinon'
import '../../features/ai-assistant/hbs-test-loader.ts'
import { attachmentIconKind, Message } from './message.ts'

// Локальная ISO-метка без зоны: парсится в локальном времени, поэтому
// ожидаемые ЧЧ:ММ и «Сегодня» не зависят от таймзоны машины с тестами
function localIso(date: Date, hhmm = '12:00:00'): string {
    const pad = (value: number) => String(value).padStart(2, '0')

    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${hhmm}`
}

const yesterday = () => {
    const date = new Date()

    date.setDate(date.getDate() - 1)

    return date
}

describe('message bubble', () => {
    it('right side: mine modifier on the li', () => {
        const message = new Message({ content: 'привет', user_id: 1, isMine: true, time: localIso(new Date()) })

        expect(message.element?.classList.contains('messenger__container-message_mine')).to.be.true
        message.destroy()
    })

    // 2026-11-07-messenger-ux-pack-2: жизненный цикл своей реплики —
    // оптимистичная запись pulse-точкой «отправляется», серверное эхо (id)
    // гасит её в одиночную галочку; чужим сообщениям маркеров нет
    it('own temp entry renders the sending dot; own id-carrying message renders the sent check', () => {
        const sending = new Message({ content: 'летит', user_id: 1, isMine: true, isSending: true, time: localIso(new Date()) })
        const sent = new Message({ content: 'дошло', user_id: 1, isMine: true, id: 42, time: localIso(new Date()) })
        const foreign = new Message({ content: 'чужое', user_id: 2, isMine: false, id: 43, time: localIso(new Date()) })

        expect(sending.element?.querySelector('[data-testid="message-status-sending"]')).to.be.not.null
        expect(sending.element?.querySelector('[data-testid="message-status-sent"]')).to.eq(null)

        expect(sent.element?.querySelector('[data-testid="message-status-sent"]')?.textContent?.trim()).to.eq('✓')
        expect(sent.element?.querySelector('[data-testid="message-status-sending"]')).to.eq(null)

        expect(foreign.element?.querySelector('[data-testid="message-status-sent"]')).to.eq(null)
        expect(foreign.element?.querySelector('[data-testid="message-status-sending"]')).to.eq(null)

        sending.destroy()
        sent.destroy()
        foreign.destroy()
    })

    it('left side: theirs modifier on the li', () => {
        const message = new Message({ content: 'привет', user_id: 2, isMine: false, time: localIso(new Date()) })

        expect(message.element?.classList.contains('messenger__container-message_theirs')).to.be.true
        message.destroy()
    })

    it('system error: yellow _error modifier on the bubble only with isError', () => {
        // провайдер бота недоступен: контроллер пишет сообщение с isError,
        // пузырь подсвечивается жёлтым (chats-social, provider_failed)
        const failed = new Message({ content: '⚠ Ассистент недоступен', user_id: -1, isMine: false, isError: true, time: localIso(new Date()) })
        const normal = new Message({ content: 'привет', user_id: 2, isMine: false, time: localIso(new Date()) })

        expect(failed.element?.querySelector('.messenger__message-bubble')?.classList.contains('messenger__message-bubble_error')).to.be.true
        expect(normal.element?.querySelector('.messenger__message-bubble')?.classList.contains('messenger__message-bubble_error')).to.be.false

        failed.destroy()
        normal.destroy()
    })

    it('bot run tail: _pending modifier on the bubble only with isPending', () => {
        // прогон бота идёт минутами: контроллер хвостит ленту плейсхолдером,
        // пузырь пульсирует (2026-11-02 bot-run feedback); без id — действия
        // не рендерятся
        const pending = new Message({ content: 'Ассистент печатает…', user_id: -1, isMine: false, isPending: true, time: localIso(new Date()) })
        const normal = new Message({ content: 'привет', user_id: 2, isMine: false, time: localIso(new Date()) })

        expect(pending.element?.querySelector('.messenger__message-bubble')?.classList.contains('messenger__message-bubble_pending')).to.be.true
        expect(pending.element?.querySelector('[data-testid="message-actions"]')).to.not.exist
        expect(normal.element?.querySelector('.messenger__message-bubble')?.classList.contains('messenger__message-bubble_pending')).to.be.false

        pending.destroy()
        normal.destroy()
    })

    // Анимация «печатает» до первой дельты (2026-11-04-bot-wait-offline):
    // маркер — целиком CSS (пульс пузыря + три точки ::after на _pending в
    // messenger.scss), никакого JS/DOM-носителя и ни одного store-тика —
    // пузырь остаётся ровно тем же узлом, что и без анимации
    it('typing marker: the pending modifier is the pure-CSS carrier, no extra DOM or store ticks', () => {
        const pending = new Message({ content: 'Ассистент печатает…', user_id: -1, isMine: false, isPending: true, time: localIso(new Date()) })
        const bubble = pending.element?.querySelector('.messenger__message-bubble') as HTMLElement

        expect(bubble.classList.contains('messenger__message-bubble_pending')).to.be.true
        expect(bubble.querySelector('.messenger__message-content')?.textContent).to.equal('Ассистент печатает…')

        // носитель анимации — класс модификатора, не узлы: внутри пузыря
        // только контент и время, никаких маркеров-элементов
        expect(bubble.children.length).to.equal(2)
        expect(bubble.querySelector('[data-testid*="typing"]')).to.not.exist

        pending.destroy()
    })

    it('renders HH:MM from the ISO time', () => {
        const message = new Message({ content: 'привет', user_id: 1, time: '2026-10-19T09:07:00' })

        expect(message.element?.querySelector('.messenger__message-time')?.textContent?.trim()).to.equal('09:07')
        message.destroy()
    })

    it('renders the day marker only when showDate is set', () => {
        const withMarker = new Message({ content: 'привет', user_id: 1, time: localIso(new Date()), showDate: true })
        const withoutMarker = new Message({ content: 'привет', user_id: 1, time: localIso(new Date()), showDate: false })

        expect(withMarker.element?.querySelector('.messenger__message-day')?.textContent?.trim()).to.equal('Сегодня')
        expect(withoutMarker.element?.querySelector('.messenger__message-day')).to.not.exist

        withMarker.destroy()
        withoutMarker.destroy()
    })

    it('labels yesterday as «Вчера»', () => {
        const message = new Message({ content: 'привет', user_id: 1, time: localIso(yesterday()), showDate: true })

        expect(message.element?.querySelector('.messenger__message-day')?.textContent?.trim()).to.equal('Вчера')
        message.destroy()
    })

    it('labels a date of another year with the year', () => {
        const message = new Message({ content: 'привет', user_id: 1, time: '2020-05-01T10:00:00', showDate: true })
        const label = message.element?.querySelector('.messenger__message-day')?.textContent?.trim() ?? ''

        expect(label).to.include('2020')
        message.destroy()
    })

    it('invalid time: no time node, no day marker, no throw', () => {
        const render = () => {
            const message = new Message({ content: 'привет', user_id: 1, time: 't17', showDate: true })

            expect(message.element?.querySelector('.messenger__message-time')).to.not.exist
            expect(message.element?.querySelector('.messenger__message-day')).to.not.exist
            message.destroy()
        }

        expect(render).to.not.throw()
    })

    it('empty time renders without the time node', () => {
        const message = new Message({ content: 'привет', user_id: 1, time: '' })

        expect(message.element?.querySelector('.messenger__message-time')).to.not.exist
        message.destroy()
    })

    it('missing time renders the bubble anyway', () => {
        const message = new Message({ content: 'привет', user_id: 1 })

        expect(message.element?.querySelector('.messenger__message-content')?.textContent?.trim()).to.equal('привет')
        expect(message.element?.querySelector('.messenger__message-time')).to.not.exist
        message.destroy()
    })
})

// Файловый список вложений (2026-11-02-ui-ux): пункт на каждый attachment —
// иконка по расширению имени (pdf; xls/xlsx -> xlsx; doc/docx -> doc; иначе
// generic), имя (double-stash — экранирование), «Скачать» с download-
// атрибутом на безопасный URL. Прежняя одиночная ссылка «Вложение»/«Скачать»
// ушла; autoDownload больше не ветвит рендер (проп зарезервирован под
// будущие превью).
describe('message attachment file list', () => {
    it('renders one file row per attachment with icon, name and download', () => {
        const message = new Message({
            content: 'документы',
            user_id: 1,
            attachments: [
                { name: 'Заявление на отпуск.pdf', url: '/api/v1/files/9/download' },
                { name: 'Бюджет отдела 2026.xlsx', url: '/api/v1/files/9/download' },
            ],
        })

        const rows = [...(message.element?.querySelectorAll('[data-testid="message-file"]') ?? [])]

        expect(rows).to.have.length(2)
        expect(rows[0].querySelector('.messenger__message-file-name')?.textContent?.trim())
            .to.equal('Заявление на отпуск.pdf')
        expect(rows[0].querySelector<HTMLImageElement>('.messenger__message-file-icon')?.getAttribute('src'))
            .to.equal('/images/file-pdf.svg')
        expect(rows[1].querySelector<HTMLImageElement>('.messenger__message-file-icon')?.getAttribute('src'))
            .to.equal('/images/file-xlsx.svg')

        const download = rows[0].querySelector<HTMLAnchorElement>('[data-testid="attachment-download"]')

        expect(download?.getAttribute('href')).to.equal('/api/v1/files/9/download')
        expect(download?.hasAttribute('download')).to.be.true
        expect(download?.textContent?.trim()).to.equal('Скачать')

        message.destroy()
    })

    it('maps docx to the doc icon and unknown extensions to the generic one', () => {
        const message = new Message({
            content: 'микс',
            user_id: 1,
            attachments: [
                { name: 'Инструкция.docx', url: '/f/1' },
                { name: 'Фото архива.zip', url: '/f/2' },
                { name: 'без расширения', url: '/f/3' },
            ],
        })

        const icons = [...(message.element?.querySelectorAll('.messenger__message-file-icon') ?? [])]
            .map(icon => icon.getAttribute('src'))

        expect(icons).to.deep.equal([
            '/images/file-doc.svg',
            '/images/file-generic.svg',
            '/images/file-generic.svg',
        ])

        message.destroy()
    })

    it('renders hostile attachment names as text (XSS)', () => {
        const message = new Message({
            content: 'зло',
            user_id: 1,
            attachments: [{ name: '<script>alert(1)</script>.pdf', url: '/f/1' }],
        })

        expect(message.element?.querySelector('script')).to.not.exist
        expect(message.element?.querySelector('.messenger__message-file-name')?.innerHTML)
            .to.contain('&lt;script&gt;')

        message.destroy()
    })

    it('renders no file list without attachments', () => {
        const message = new Message({ content: 'без файла', user_id: 1, fileUrl: '/api/v1/files/5/download' })

        expect(message.element?.querySelector('[data-testid="message-files"]')).to.not.exist
        expect(message.element?.querySelector('[data-testid="attachment-download"]')).to.not.exist

        message.destroy()
    })

    it('attachmentIconKind covers the extension table', () => {
        expect(attachmentIconKind('a.PDF')).to.equal('pdf')
        expect(attachmentIconKind('a.xls')).to.equal('xlsx')
        expect(attachmentIconKind('a.XLSX')).to.equal('xlsx')
        expect(attachmentIconKind('a.doc')).to.equal('doc')
        expect(attachmentIconKind('a.docx')).to.equal('doc')
        expect(attachmentIconKind('архив.rar')).to.equal('generic')
        expect(attachmentIconKind('имябезрасширения')).to.equal('generic')
    })
})

// Реакции и реплаи (chats-social): аффордансы только у сообщений с id,
// чипы с подсветкой своего, фиксированный набор эмодзи, блок цитаты —
// NaN-safe (мусорный/пустой сниппет не рендерится).

describe('message reactions affordances', () => {
    it('renders the actions for an identified message and hides them without id', () => {
        const withId = new Message({ content: 'привет', user_id: 1, chat_id: 3, id: 11 })
        const withoutId = new Message({ content: 'привет', user_id: 1 })

        expect(withId.element?.querySelector('[data-testid="message-actions"]')).to.exist
        expect(withId.element?.querySelector('[data-testid="message-reactions-toggle"]')).to.exist
        expect(withId.element?.querySelector('[data-testid="message-reply"]')).to.exist
        expect(withoutId.element?.querySelector('[data-testid="message-actions"]')).to.not.exist

        withId.destroy()
        withoutId.destroy()
    })

    it('opens the fixed emoji set on the affordance click and closes after pick', () => {
        const onSetReaction = sinon.spy()
        const message = new Message({ content: 'привет', user_id: 1, chat_id: 3, id: 11, onSetReaction })

        message.element?.querySelector('[data-testid="message-reactions-toggle"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))

        const picker = message.element?.querySelector('[data-testid="emoji-picker"]')

        expect(picker).to.exist
        expect(picker?.querySelectorAll('[data-testid="emoji-option"]')).to.have.length(6)

        picker?.querySelector<HTMLButtonElement>('[data-emoji="❤️"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))

        expect(onSetReaction.calledOnceWith(3, 11, '❤️')).to.be.true
        expect(message.element?.querySelector('[data-testid="emoji-picker"]')).to.not.exist

        message.destroy()
    })

    // 2026-11-10: клик мимо сообщения гасит пикер; слушатель document
    // снимается сам (второй наружный клик — no-op). Сообщение обязано быть
    // в DOM: отвязанный элемент (isConnected) слушатель игнорирует
    it('closes the open picker on a click outside the message and drops the document listener', () => {
        const removeSpy = sinon.spy(document, 'removeEventListener')
        const message = new Message({ content: 'привет', user_id: 1, chat_id: 3, id: 11 })
        const outside = document.createElement('div')

        document.body.append(outside, message.element as HTMLElement)

        message.element?.querySelector('[data-testid="message-reactions-toggle"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))

        expect(message.element?.querySelector('[data-testid="emoji-picker"]')).to.exist

        outside.dispatchEvent(new MouseEvent('click', { bubbles: true }))

        expect(message.element?.querySelector('[data-testid="emoji-picker"]')).to.not.exist
        expect(removeSpy.calledWith('click')).to.be.true

        outside.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        expect(message.element?.querySelector('[data-testid="emoji-picker"]')).to.not.exist

        outside.remove()
        removeSpy.restore()
        message.destroy()
    })

    // то же событие открытия долетает до document — клик внутри сообщения
    // (включая кнопку-тоггл) пикер не закрывает
    it('keeps the picker open for clicks inside the message', () => {
        const message = new Message({ content: 'привет', user_id: 1, chat_id: 3, id: 11 })

        document.body.append(message.element as HTMLElement)

        message.element?.querySelector('[data-testid="message-reactions-toggle"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        message.element?.querySelector('.messenger__message-bubble')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))

        expect(message.element?.querySelector('[data-testid="emoji-picker"]')).to.exist

        message.destroy()
    })

    it('destroy drops the outside-close listener of an open picker', () => {
        const removeSpy = sinon.spy(document, 'removeEventListener')
        const message = new Message({ content: 'привет', user_id: 1, chat_id: 3, id: 11 })

        document.body.append(message.element as HTMLElement)

        message.element?.querySelector('[data-testid="message-reactions-toggle"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        message.destroy()

        expect(removeSpy.calledWith('click')).to.be.true

        removeSpy.restore()
    })

    it('toggles a reaction from the chip click', () => {
        const onSetReaction = sinon.spy()
        const message = new Message({
            content: 'привет',
            user_id: 1,
            chat_id: 3,
            id: 11,
            onSetReaction,
            reactions: [{ emoji: '👍', count: 2, mine: true }],
        })

        message.element?.querySelector<HTMLButtonElement>('[data-testid="reaction-chip"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))

        expect(onSetReaction.calledOnceWith(3, 11, '👍')).to.be.true

        message.destroy()
    })

    it('renders chips with counts and highlights the own one', () => {
        const message = new Message({
            content: 'привет',
            user_id: 1,
            chat_id: 3,
            id: 11,
            reactions: [
                { emoji: '👍', count: 2, mine: true },
                { emoji: '😂', count: 1, mine: false },
            ],
        })

        const chips = message.element?.querySelectorAll('[data-testid="reaction-chip"]') ?? []

        expect(chips).to.have.length(2)
        expect(chips[0].classList.contains('messenger__reaction-chip_mine')).to.be.true
        expect(chips[1].classList.contains('messenger__reaction-chip_mine')).to.be.false
        expect(chips[0].querySelector('[data-testid="reaction-count"]')?.textContent?.trim()).to.equal('2')

        message.destroy()
    })

    it('renders no chips row for an empty summary', () => {
        const message = new Message({ content: 'привет', user_id: 1, chat_id: 3, id: 11, reactions: [] })

        expect(message.element?.querySelector('[data-testid="message-reactions"]')).to.not.exist

        message.destroy()
    })

    it('emits the reply draft from the reply action', () => {
        const onReply = sinon.spy()
        const message = new Message({ content: 'цитируемое', user_id: 1, chat_id: 3, id: 11, onReply })

        message.element?.querySelector('[data-testid="message-reply"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))

        expect(onReply.calledOnceWith({ id: 11, snippet: 'цитируемое' })).to.be.true

        message.destroy()
    })
})

describe('message reply quote block', () => {
    it('renders the quoted snippet with the reply label', () => {
        const message = new Message({
            content: 'ответ',
            user_id: 1,
            chat_id: 3,
            id: 12,
            replyTo: { id: 11, user_id: 2, snippet: 'первое сообщение' },
        })

        const quote = message.element?.querySelector('[data-testid="message-quote"]')

        expect(quote?.textContent?.trim()).to.contain('В ответ')
        expect(quote?.textContent?.trim()).to.contain('первое сообщение')

        message.destroy()
    })

    it('NaN-safe: null quote and empty snippet render no block', () => {
        const nullQuote = new Message({ content: 'ответ', user_id: 1, replyTo: null })
        const emptySnippet = new Message({
            content: 'ответ',
            user_id: 1,
            replyTo: { id: 11, user_id: 2, snippet: '' },
        })

        expect(nullQuote.element?.querySelector('[data-testid="message-quote"]')).to.not.exist
        expect(emptySnippet.element?.querySelector('[data-testid="message-quote"]')).to.not.exist

        nullQuote.destroy()
        emptySnippet.destroy()
    })
})


// 2026-11-05-messenger-ux-pack: системные события ленты (messages.kind) —
// служебная строка по центру без пузыря, аффордансов и реакций
describe('message system line', () => {
    it('renders a kind-bearing message as the centered service line without a bubble', () => {
        const system = new Message({
            content: 'bob переименовал чат в «Проект»',
            user_id: 2,
            kind: 'chat_renamed',
            id: 11,
            chat_id: 3,
            time: localIso(new Date()),
        })

        expect(system.element?.querySelector('[data-testid="message-system"]')).to.exist
        expect(system.element?.querySelector('.messenger__message-bubble')).to.not.exist
        // аффордансы ответа/реакций системной строке не положены
        expect(system.element?.querySelector('[data-testid="message-actions"]')).to.not.exist
        expect(system.element?.querySelector('[data-testid="message-reactions-toggle"]')).to.not.exist

        system.destroy()
    })

    it('renders an ordinary message with the bubble and without the service line', () => {
        const normal = new Message({ content: 'привет', user_id: 2, id: 12, chat_id: 3, time: localIso(new Date()) })

        expect(normal.element?.querySelector('[data-testid="message-system"]')).to.not.exist
        expect(normal.element?.querySelector('.messenger__message-bubble')).to.exist

        normal.destroy()
    })

    it('renders the system content as escaped text (XSS)', () => {
        const hostile = new Message({
            content: 'a <script>alert(1)</script> переименовал чат в «<img src=x onerror=alert(1)>»',
            user_id: 2,
            kind: 'chat_renamed',
            time: localIso(new Date()),
        })

        const line = hostile.element?.querySelector('[data-testid="message-system"]')

        expect(line?.querySelector('script')).to.not.exist
        expect(line?.innerHTML).to.contain('&lt;script&gt;')

        hostile.destroy()
    })
})

// 2026-11-08-mobile-messenger-ux: мета-строка над пузырём — плашка автора
// (аватар + логин, title=email) и AI-чип ответов бота
describe('message author plate and ai chip', () => {
    const badge = { login: 'alice@x.io', email: 'alice@x.io', avatar: '/alice.png' }

    it('renders the author plate with the avatar, login and email tooltip', () => {
        const message = new Message({ content: 'привет', user_id: 8, isMine: false, authorBadge: badge, time: localIso(new Date()) })

        const plate = message.element?.querySelector('[data-testid="message-author-badge"]')

        expect(plate?.textContent).to.contain('alice@x.io')
        expect(plate?.getAttribute('title')).to.eq('alice@x.io')
        expect(plate?.querySelector('img.messenger__message-author-avatar')?.getAttribute('src')).to.eq('/alice.png')

        message.destroy()
    })

    it('renders the ai chip alone for a bot answer', () => {
        const message = new Message({ content: 'ответ бота', user_id: 9, isMine: false, isBot: true, time: localIso(new Date()) })

        expect(message.element?.querySelector('[data-testid="message-ai-badge"]')?.textContent?.trim()).to.eq('✦ AI')
        expect(message.element?.querySelector('[data-testid="message-author-badge"]')).to.eq(null)

        message.destroy()
    })

    it('renders the plate and the chip together in one meta row', () => {
        const message = new Message({ content: 'в группе', user_id: 9, isMine: false, authorBadge: badge, isBot: true, time: localIso(new Date()) })

        const meta = message.element?.querySelector('[data-testid="message-meta"]')

        expect(meta?.querySelector('[data-testid="message-author-badge"]')).to.not.eq(null)
        expect(meta?.querySelector('[data-testid="message-ai-badge"]')).to.not.eq(null)

        message.destroy()
    })

    // 2026-11-09: склейка серии — модификаторы пузыря (зеркальные углы
    // сторон — в messenger.scss, здесь проводка пропсов в шаблон)
    it('carries the glue modifiers on the bubble', () => {
        const start = new Message({ content: 'первое', user_id: 8, isMine: false, time: localIso(new Date()) })
        const middle = new Message({ content: 'середина', user_id: 8, isMine: false, glued: true, time: localIso(new Date()) })
        const last = new Message({ content: 'замыкающее', user_id: 8, isMine: false, glued: true, gluedLast: true, time: localIso(new Date()) })

        const bubbleOf = (item: Message) => item.element?.querySelector('.messenger__message-bubble')

        expect(bubbleOf(start)?.classList.contains('messenger__message-bubble_glued')).to.eq(false)
        expect(bubbleOf(middle)?.classList.contains('messenger__message-bubble_glued')).to.eq(true)
        expect(bubbleOf(middle)?.classList.contains('messenger__message-bubble_glued_last')).to.eq(false)
        expect(bubbleOf(last)?.classList.contains('messenger__message-bubble_glued')).to.eq(true)
        expect(bubbleOf(last)?.classList.contains('messenger__message-bubble_glued_last')).to.eq(true)

        start.destroy()
        middle.destroy()
        last.destroy()
    })

    it('plain human messages and system lines render no meta row', () => {
        const human = new Message({ content: 'привет', user_id: 2, isMine: false, time: localIso(new Date()) })
        const system = new Message({ content: 'переименовал чат', user_id: 2, kind: 'chat_renamed', time: localIso(new Date()) })

        expect(human.element?.querySelector('[data-testid="message-meta"]')).to.eq(null)
        expect(system.element?.querySelector('[data-testid="message-meta"]')).to.eq(null)

        human.destroy()
        system.destroy()
    })
})

// Живой поиск бара (2026-10-26-chat-search): дебаунс 300 мс гейтит только
// вызов onSearch; видимый текст и фокус живут в модульной памяти и
// переживают пересоздание инстанса перерисовкой страницы.

import { expect } from 'chai'
import { JSDOM } from 'jsdom'
import sinon from 'sinon'
import '../../features/ai-assistant/hbs-test-loader.ts'
import { CHAT_SEARCH_DEBOUNCE_MS, getChatSearchBarMemory, SearchBar } from './searchBar.ts'

const dom = new JSDOM()
global.document = dom.window.document

// mochaSetup даёт только MouseEvent-глобал: слушатель бара смотрит на
// event.type и target, интерфейс события не важен
const typeInto = (bar: SearchBar, value: string, caret?: number): HTMLInputElement => {
    const input = bar.element?.querySelector<HTMLInputElement>('input[name="chat_search"]')

    if (input == null) {
        throw new Error('инпут поиска не отрендерился')
    }

    input.value = value

    if (caret != null) {
        input.setSelectionRange(caret, caret)
    }

    input.dispatchEvent(new dom.window.MouseEvent('input', { bubbles: true }))

    return input
}

const blurFrom = (bar: SearchBar): void => {
    bar.element?.querySelector('input[name="chat_search"]')?.dispatchEvent(
        new dom.window.MouseEvent('focusout', { bubbles: true }),
    )
}

// Модульная память глобальна: между тестами возвращаем её к чистому
// листу через те же события (отдельного сеттера сознательно нет)
const resetMemory = (): void => {
    const bar = new SearchBar()
    typeInto(bar, '')
    blurFrom(bar)
    bar.destroy()
}

describe('search bar live search', () => {
    let clock: sinon.SinonFakeTimers

    beforeEach(() => {
        clock = sinon.useFakeTimers()
    })

    afterEach(() => {
        clock.restore()
        resetMemory()
    })

    it('debounces onSearch at 300 ms', () => {
        const onSearch = sinon.stub()
        const bar = new SearchBar({ onSearch })

        typeInto(bar, 'ab')
        clock.tick(CHAT_SEARCH_DEBOUNCE_MS - 1)
        expect(onSearch.called).to.be.false

        clock.tick(1)
        expect(onSearch.calledOnceWith('ab')).to.be.true

        bar.destroy()
    })

    it('reschedules the debounce on every keystroke', () => {
        const onSearch = sinon.stub()
        const bar = new SearchBar({ onSearch })

        typeInto(bar, 'a')
        clock.tick(200)
        typeInto(bar, 'ab')
        clock.tick(200)
        expect(onSearch.called).to.be.false

        clock.tick(100)
        expect(onSearch.calledOnceWith('ab')).to.be.true

        bar.destroy()
    })

    it('fires onSearch with the empty string when the input is cleared', () => {
        const onSearch = sinon.stub()
        const bar = new SearchBar({ onSearch })

        typeInto(bar, 'ab')
        clock.tick(CHAT_SEARCH_DEBOUNCE_MS)
        typeInto(bar, '')
        clock.tick(CHAT_SEARCH_DEBOUNCE_MS)

        expect(onSearch.calledTwice).to.be.true
        expect(onSearch.secondCall.calledWith('')).to.be.true

        bar.destroy()
    })

    it('drops the pending timer on destroy', () => {
        const onSearch = sinon.stub()
        const bar = new SearchBar({ onSearch })

        typeInto(bar, 'ab')
        bar.destroy()
        clock.tick(CHAT_SEARCH_DEBOUNCE_MS * 2)

        expect(onSearch.called).to.be.false
    })

    it('keeps the uncommitted text and focus through a re-instantiation mid-typing', () => {
        const first = new SearchBar({ onSearch: sinon.stub() })

        typeInto(first, 'ab', 1)
        clock.tick(100)
        first.destroy()

        const memory = getChatSearchBarMemory()
        expect(memory.value).to.equal('ab')
        expect(memory.wasFocused).to.be.true
        expect(memory.caret).to.equal(1)

        const second = new SearchBar()
        const revived = second.element?.querySelector<HTMLInputElement>('input[name="chat_search"]')
        expect(revived?.value).to.equal('ab')

        second.destroy()
    })

    it('marks focus as lost after blur', () => {
        const bar = new SearchBar()

        typeInto(bar, 'ab')
        blurFrom(bar)
        expect(getChatSearchBarMemory().wasFocused).to.be.false

        bar.destroy()
    })

    it('prevents the default submit — Enter must not reload the SPA (F-1)', () => {
        const bar = new SearchBar()
        const form = bar.element

        // корень шаблона — сама форма, слушатель submit висит на ней
        expect(form?.tagName).to.equal('FORM')

        // cancelable обязателен: без него preventDefault ничего не меняет
        const submit = new dom.window.Event('submit', { bubbles: true, cancelable: true })

        form?.dispatchEvent(submit)

        expect(submit.defaultPrevented).to.be.true

        bar.destroy()
    })
})

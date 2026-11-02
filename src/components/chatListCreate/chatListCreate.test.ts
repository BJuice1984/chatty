// Компонент создания чата (2026-10-27-ai-chat-creation): чекбокс ИИ-чата
// рендерится СОСЕДОМ Form внутри <li> (у формы нет слота, а сериализация
// читает element.value — 'on' при любом checked), one-click-плитка «Чат с
// AI» — Button с type=button (не submit — иначе сабмитила бы форму).

import { expect } from 'chai'
import { JSDOM } from 'jsdom'
import sinon from 'sinon'
import '../../features/ai-assistant/hbs-test-loader.ts'
import Handlebars from 'handlebars'
import type Block from '../../core/Block.ts'
import { registerComponent } from '../../core/registerComponent.ts'
import * as Components from '../../components/components.ts'
import { ChatListCreate } from './chatListCreate.ts'

const dom = new JSDOM()
global.document = dom.window.document

// Регистрация как в прод-сборке main.ts (components.ts): шаблон компонента
// зовёт хелперы Form и Button — без регистрации они не отрисуются.
// Гвард от повторной загрузки модуля — прецедент chat.test.ts
Object.entries(Components).forEach(([name, component]) => {
    if (!(name in Handlebars.helpers)) {
        registerComponent(name, component as typeof Block)
    }
})

interface ChatListCreateProps {
    isShown: boolean
    // eslint-disable-next-line no-unused-vars
    onAiChatClick?: () => void
}

function render(props: { onAiChatClick?: () => void } = {}): ChatListCreate {
    // inputs/buttons идут сквозным пропсом (как со страницы в chat.hbs),
    // но в публичный тип компонента не входят — пустые массивы ради Form
    return new ChatListCreate({
        isShown: true,
        inputs: [],
        buttons: [],
        ...props,
    } as ChatListCreateProps)
}

describe('chat list create ai entries', () => {
    it('renders the is_ai checkbox as a sibling of the form, not inside it', () => {
        const item = render()
        const checkbox = item.element?.querySelector<HTMLInputElement>('input[name="is_ai"]')
        const form = item.element?.querySelector('form')

        expect(checkbox).to.exist
        expect(checkbox?.type).to.eq('checkbox')
        // ключевой пин: чекбокс НЕ внутри формы — сериализация submit его
        // не читает, состояние берёт страница из DOM в момент сабмита
        expect(form).to.exist
        expect(form?.querySelector('input[name="is_ai"]')).to.not.exist
        // тот же контейнер контента: ровно соседи внутри <li>
        expect(checkbox?.closest('div')).to.eq(form?.closest('div'))

        item.destroy()
    })

    it('renders the AI tile as a type=button Button firing onAiChatClick', () => {
        const onAiChatClick = sinon.stub()
        const item = render({ onAiChatClick })
        const tile = item.element?.querySelector<HTMLButtonElement>('button[type="button"]')

        expect(tile).to.exist
        expect(tile?.textContent?.trim()).to.eq('Чат с AI')
        // type=button: клик не сабмитит форму создания
        expect(tile?.getAttribute('type')).to.eq('button')

        tile?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
        expect(onAiChatClick.calledOnce).to.be.true

        item.destroy()
    })

    it('renders both AI entries inside the single list-item <li>', () => {
        const item = render()

        // корень компонента — сам <li> строки списка: обе ИИ-точки входа
        // живут в его границах
        expect(item.element?.tagName).to.eq('LI')
        expect(item.element?.classList.contains('chat-list-create')).to.be.true
        expect(item.element?.querySelector('input[name="is_ai"]')).to.exist
        expect(item.element?.querySelector('button[type="button"]')).to.exist

        item.destroy()
    })
})

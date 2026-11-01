// Страница настроек (2026-11-01-settings): шесть пунктов сайдбара ведут правую
// панель (active-модификатор + видимость секций), Account правит
// display_name/phone и показывает email/login read-only, смена пароля несёт
// политику 12+ и совпадение повтора, «Sign out everywhere» — за модалкой;
// Chats — архив с «Вернуться» (карточка оживает рефетчем стора), Appearance —
// радио темы на живом dataset, Notification/Privacy/Data — тумблеры
// preferences / PUT profile / GET usage. Контроллер подменяется заглушкой
// через сеттер композиции; шаблон грузится тестовым погрузчиком, компоненты —
// импортом components.ts, как в прод-сборке main.ts.

import { expect } from 'chai'
import sinon from 'sinon'
import { JSDOM } from 'jsdom'
import '../../../ai-assistant/hbs-test-loader.ts'
import Handlebars from 'handlebars'
import type Block from '../../../../core/Block.ts'
import { registerComponent } from '../../../../core/registerComponent.ts'
import * as Components from '../../../../components/components.ts'
import store from '../../../../utils/Store.ts'
import { getPreferences, initPreferences, setPreference } from '../../../../utils/preferences.ts'
import { applyTheme } from '../../../../utils/theme.ts'
import { ProfileFeatureController, setProfileController } from '../../controller.ts'
import type { ProfilePort } from '../../ports.ts'
import { formatUsageSize, ProfilePage } from './profile.ts'

const dom = new JSDOM('<body></body>', { url: 'http://localhost:3000/settings' })
global.document = dom.window.document

// Form-контракт проверяет instanceof HTMLFormElement — глобала из mochaSetup
// нет. Конструктор берём от ЖИВОГО global.document ПЕРЕД каждым тестом:
// сабмит-файлы переприсваивают его своими jsdom и по пути к этому файлу
// документ уже чужой — рассинхрон конструктора молча резал бы сабмит
function syncFormContract(): void {
    const view = global.document.defaultView as { HTMLFormElement?: typeof HTMLFormElement } | null

    global.HTMLFormElement = (view?.HTMLFormElement ?? dom.window.HTMLFormElement) as typeof HTMLFormElement
}

Object.entries(Components).forEach(([name, component]) => {
    if (!(name in Handlebars.helpers)) {
        registerComponent(name, component as typeof Block)
    }
})

const user = {
    id: 7,
    first_name: '',
    second_name: '',
    login: 'bob@chatty.local',
    email: 'bob@chatty.local',
    display_name: 'bob',
    phone: '89001234567',
    avatar: '',
    send_read_receipts: true,
}

// герметичный контроллер: порт недостижим — методы подменяются sinon-заглушками
const controller = new ProfileFeatureController({} as ProfilePort)

const click = (node: Element | null | undefined): void => {
    node?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
}

const clickItem = (page: { element?: Element | null }, name: string): void => {
    const items = [...(page.element?.querySelectorAll('[data-testid="settings-item"]') ?? [])]
    const target = items.find(item => item.textContent?.includes(name))

    click(target ?? null)
}

const fieldOf = (page: { element?: Element | null }, name: string): HTMLInputElement | null =>
    page.element?.querySelector<HTMLInputElement>(`input[name="${name}"]`) ?? null

const submitForm = (form: Element | null | undefined): void => {
    form?.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }))
}

const inOpenModal = (page: { element?: Element | null }, testid: string): Element | null =>
    page.element?.querySelector(`.modal_open [data-testid="${testid}"]`) ?? null

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

describe('settings page sections', () => {
    beforeEach(() => {
        setProfileController(controller)
        store.set('user', { ...user })
        window.localStorage.removeItem('chatty-preferences')
        initPreferences()
    })

    afterEach(() => {
        sinon.restore()
        store.set('user', undefined)
        store.set('chats', undefined)
        window.localStorage.removeItem('chatty-preferences')
        initPreferences()
        window.localStorage.removeItem('chatty-theme')
        applyTheme('system')
    })

    it('renders the account section by default and hides the others', () => {
        const page = new ProfilePage({} as never)

        try {
            expect(page.element?.querySelector('[data-testid="settings-section-account"]')).to.exist
            expect(page.element?.querySelector('[data-testid="settings-section-chats"]')).to.not.exist
            expect(page.element?.querySelector('[data-testid="settings-section-appearance"]')).to.not.exist
            expect(page.element?.querySelector('[data-testid="settings-section-notification"]')).to.not.exist
            expect(page.element?.querySelector('[data-testid="settings-section-privacy"]')).to.not.exist
            expect(page.element?.querySelector('[data-testid="settings-section-data"]')).to.not.exist
        } finally {
            page.destroy()
        }
    })

    it('navigates the right pane from all six sidebar items', () => {
        const page = new ProfilePage({} as never)
        const sections: [string, string][] = [
            ['Account', 'settings-section-account'],
            ['Chats', 'settings-section-chats'],
            ['Appearance', 'settings-section-appearance'],
            ['Notification', 'settings-section-notification'],
            ['Privacy', 'settings-section-privacy'],
            ['Data Usage', 'settings-section-data'],
        ]

        try {
            for (const [name, testid] of sections) {
                clickItem(page, name)

                const visible = sections.filter(([, id]) => id !== testid)
                    .every(([, id]) => page.element?.querySelector(`[data-testid="${id}"]`) == null)

                expect(page.element?.querySelector(`[data-testid="${testid}"]`), name).to.exist
                expect(visible, `only ${name} is visible`).to.be.true
            }
        } finally {
            page.destroy()
        }
    })

    it('marks the active sidebar item and clears the previous one', () => {
        const page = new ProfilePage({} as never)

        try {
            const activeModifier = (name: string) =>
                [...(page.element?.querySelectorAll('[data-testid="settings-item"]') ?? [])]
                    .find(item => item.textContent?.includes(name))
                    ?.classList.contains('profile-settings-item_active')

            clickItem(page, 'Appearance')

            expect(activeModifier('Appearance')).to.be.true
            expect(activeModifier('Account')).to.be.false

            clickItem(page, 'Account')

            expect(activeModifier('Account')).to.be.true
            expect(activeModifier('Appearance')).to.be.false
        } finally {
            page.destroy()
        }
    })

    it('shows the display name in the sidebar', () => {
        const page = new ProfilePage({} as never)

        try {
            expect(page.element?.querySelector('.chat__container-profile-info-contact')?.textContent)
                .to.contain('bob')
        } finally {
            page.destroy()
        }
    })
})

describe('settings account section', () => {
    beforeEach(() => {
        syncFormContract()
        setProfileController(controller)
        store.set('user', { ...user })
        window.localStorage.removeItem('chatty-preferences')
        initPreferences()
    })

    afterEach(() => {
        sinon.restore()
        store.set('user', undefined)
        store.set('chats', undefined)
        window.localStorage.removeItem('chatty-preferences')
        initPreferences()
    })

    it('renders email and login as read-only rows', () => {
        const page = new ProfilePage({} as never)

        try {
            expect(page.element?.querySelector('[data-testid="readonly-email"]')?.textContent)
                .to.contain('bob@chatty.local')
            expect(page.element?.querySelector('[data-testid="readonly-login"]')?.textContent)
                .to.contain('bob@chatty.local')

            const accountForm = page.element?.querySelector('[data-testid="account-form"] input[name="email"]')

            expect(accountForm).to.not.exist
        } finally {
            page.destroy()
        }
    })

    it('renders hostile user fields as text (XSS)', () => {
        store.set('user', {
            ...user,
            display_name: '<script>alert(1)</script>',
            login: 'bob<script>x</script>@chatty.local',
        })

        const page = new ProfilePage({} as never)

        try {
            expect(page.element?.querySelector('script')).to.not.exist
            expect(page.element?.querySelector('.chat__container-profile-info-contact')?.innerHTML)
                .to.contain('&lt;script&gt;')
            expect(page.element?.querySelector('[data-testid="readonly-login"]')?.innerHTML)
                .to.contain('&lt;script&gt;')

            // слот модалки строит escapeHtml-билдер — логин тоже текстом
            click(page.element?.querySelector('[data-testid="logout-all-open"]'))

            expect(inOpenModal(page, 'logout-all-text')?.innerHTML).to.contain('&lt;script&gt;')
        } finally {
            page.destroy()
        }
    })

    it('edits display_name and phone through the profile controller', () => {
        const changeUserInfo = sinon.stub(controller, 'changeUserInfo').resolves()
        const page = new ProfilePage({} as never)

        try {
            expect(fieldOf(page, 'display_name')?.value).to.equal('bob')
            expect(fieldOf(page, 'phone')?.value).to.equal('89001234567')

            const displayName = fieldOf(page, 'display_name')
            const phone = fieldOf(page, 'phone')

            if (displayName != null && phone != null) {
                displayName.value = 'Боб'
                phone.value = '89005553535'
            }

            submitForm(page.element?.querySelector('[data-testid="account-form"] form'))

            expect(changeUserInfo.calledOnce).to.be.true
            expect(changeUserInfo.firstCall.args[0]).to.deep.equal({
                display_name: 'Боб',
                phone: '89005553535',
            })
        } finally {
            page.destroy()
        }
    })

    it('blocks the submit for an invalid phone', () => {
        const changeUserInfo = sinon.stub(controller, 'changeUserInfo').resolves()
        const page = new ProfilePage({} as never)

        try {
            const phone = fieldOf(page, 'phone')

            if (phone != null) {
                phone.value = '12'
            }

            submitForm(page.element?.querySelector('[data-testid="account-form"] form'))

            expect(changeUserInfo.called).to.be.false
        } finally {
            page.destroy()
        }
    })

    it('allows an empty phone (nullable on the backend)', () => {
        const changeUserInfo = sinon.stub(controller, 'changeUserInfo').resolves()
        const page = new ProfilePage({} as never)

        try {
            const phone = fieldOf(page, 'phone')

            if (phone != null) {
                phone.value = ''
            }

            submitForm(page.element?.querySelector('[data-testid="account-form"] form'))

            expect(changeUserInfo.calledOnce).to.be.true
        } finally {
            page.destroy()
        }
    })

    it('changes the password when the repeat matches and the policy holds', () => {
        const changePassword = sinon.stub(controller, 'changePassword').resolves()
        const page = new ProfilePage({} as never)

        try {
            const oldPassword = fieldOf(page, 'old_password')
            const newPassword = fieldOf(page, 'new_password')
            const repeatPassword = fieldOf(page, 'repeat_password')

            if (oldPassword != null && newPassword != null && repeatPassword != null) {
                oldPassword.value = 'OldPassword123'
                newPassword.value = 'NewPassword1234'
                repeatPassword.value = 'NewPassword1234'
            }

            submitForm(page.element?.querySelector('[data-testid="password-form"] form'))

            expect(changePassword.calledOnceWith({
                old_password: 'OldPassword123',
                new_password: 'NewPassword1234',
            })).to.be.true
            expect(page.element?.querySelector('[data-testid="password-feedback"]')?.textContent?.trim()).to.equal('')
        } finally {
            page.destroy()
        }
    })

    it('rejects mismatching password repeat without calling the controller', () => {
        const changePassword = sinon.stub(controller, 'changePassword').resolves()
        const page = new ProfilePage({} as never)

        try {
            const oldPassword = fieldOf(page, 'old_password')
            const newPassword = fieldOf(page, 'new_password')
            const repeatPassword = fieldOf(page, 'repeat_password')

            if (oldPassword != null && newPassword != null && repeatPassword != null) {
                oldPassword.value = 'OldPassword123'
                newPassword.value = 'NewPassword1234'
                repeatPassword.value = 'Different12345'
            }

            submitForm(page.element?.querySelector('[data-testid="password-form"] form'))

            expect(changePassword.called).to.be.false
            expect(page.element?.querySelector('[data-testid="password-feedback"]')?.textContent?.trim())
                .to.equal('Новые пароли не совпадают')
        } finally {
            page.destroy()
        }
    })

    it('shows the 12+ policy message under the weak password field', () => {
        const page = new ProfilePage({} as never)

        try {
            const newPassword = fieldOf(page, 'new_password')

            if (newPassword != null) {
                newPassword.value = 'short'
                newPassword.dispatchEvent(new dom.window.Event('blur', { bubbles: true }))
            }

            const form = page.element?.querySelector('[data-testid="password-form"] form')
            const error = form?.querySelector('.input__error_visible')

            expect(error?.textContent).to.contain('от 12 до 40')
        } finally {
            page.destroy()
        }
    })

    it('blocks the password change for a weak new password', () => {
        const changePassword = sinon.stub(controller, 'changePassword').resolves()
        const page = new ProfilePage({} as never)

        try {
            const oldPassword = fieldOf(page, 'old_password')
            const newPassword = fieldOf(page, 'new_password')
            const repeatPassword = fieldOf(page, 'repeat_password')

            if (oldPassword != null && newPassword != null && repeatPassword != null) {
                oldPassword.value = 'OldPassword123'
                newPassword.value = 'Short1'
                repeatPassword.value = 'Short1'
            }

            submitForm(page.element?.querySelector('[data-testid="password-form"] form'))

            expect(changePassword.called).to.be.false
        } finally {
            page.destroy()
        }
    })

    it('signs out through the existing button', () => {
        const logout = sinon.stub(controller, 'logout').resolves()
        const page = new ProfilePage({} as never)

        try {
            const buttons = [...(page.element?.querySelectorAll('[data-testid="account-form"] button') ?? [])]
            const signOut = buttons.find(button => button.textContent?.includes('Sign out'))

            click(signOut ?? null)

            expect(logout.calledOnce).to.be.true
        } finally {
            page.destroy()
        }
    })

    it('guards logout-all behind the confirmation modal', async () => {
        const logoutAll = sinon.stub(controller, 'logoutAll').resolves()
        const page = new ProfilePage({} as never)

        try {
            click(page.element?.querySelector('[data-testid="logout-all-open"]'))

            expect(inOpenModal(page, 'logout-all-text')?.textContent).to.contain('Выйти со всех устройств')

            click(inOpenModal(page, 'logout-all-cancel'))

            expect(inOpenModal(page, 'logout-all-text')).to.not.exist
            expect(logoutAll.called).to.be.false

            click(page.element?.querySelector('[data-testid="logout-all-open"]'))
            click(inOpenModal(page, 'logout-all-confirm'))

            expect(inOpenModal(page, 'logout-all-text')).to.not.exist
            expect(logoutAll.calledOnce).to.be.true

            await flush()
        } finally {
            page.destroy()
        }
    })
})

describe('settings chats section', () => {
    beforeEach(() => {
        setProfileController(controller)
        store.set('user', { ...user })
    })

    afterEach(() => {
        sinon.restore()
        store.set('user', undefined)
        store.set('chats', undefined)
    })

    it('lists only the chats the viewer left (leftAt set)', () => {
        store.set('chats', [
            { id: 1, title: 'Активный', unread_count: 0 },
            { id: 2, title: 'Покинутый', unread_count: 0, leftAt: '2026-11-01T09:00:00Z' },
            { id: 3, title: 'Тоже активный', unread_count: 0, leftAt: null },
        ])

        const page = new ProfilePage({} as never)

        try {
            clickItem(page, 'Chats')

            const items = page.element?.querySelectorAll('[data-testid="archived-chat"]')

            expect(items).to.have.lengthOf(1)
            expect(items?.[0]?.textContent).to.contain('Покинутый')
        } finally {
            page.destroy()
        }
    })

    it('rejoins through the profile controller and the card undims via the store', () => {
        const rejoinChat = sinon.stub(controller, 'rejoinChat')
        store.set('chats', [
            { id: 2, title: 'Покинутый', unread_count: 0, leftAt: '2026-11-01T09:00:00Z' },
        ])

        const page = new ProfilePage({} as never)

        try {
            clickItem(page, 'Chats')

            click(page.element?.querySelector('[data-testid="rejoin-chat"]'))

            expect(rejoinChat.calledOnceWith(2)).to.be.true

            // рефетч списка после rejoin: leftAt ушёл — карточка ожила,
            // архивная секция опустела
            store.set('chats', [
                { id: 2, title: 'Покинутый', unread_count: 0 },
            ])

            expect(page.element?.querySelector('[data-testid="archived-chat"]')).to.not.exist
            expect(page.element?.querySelector('[data-testid="archived-empty"]')?.textContent)
                .to.contain('Нет архивированных чатов')
        } finally {
            page.destroy()
        }
    })

    it('renders the empty state without archived chats', () => {
        store.set('chats', [{ id: 1, title: 'Активный', unread_count: 0 }])

        const page = new ProfilePage({} as never)

        try {
            clickItem(page, 'Chats')

            expect(page.element?.querySelector('[data-testid="archived-chat"]')).to.not.exist
            expect(page.element?.querySelector('[data-testid="archived-empty"]')).to.exist
        } finally {
            page.destroy()
        }
    })
})

describe('settings appearance section', () => {
    beforeEach(() => {
        setProfileController(controller)
        store.set('user', { ...user })
        window.localStorage.removeItem('chatty-theme')
        applyTheme('system')
    })

    afterEach(() => {
        sinon.restore()
        store.set('user', undefined)
        store.set('chats', undefined)
        window.localStorage.removeItem('chatty-theme')
        applyTheme('system')
    })

    it('checks the current theme radio', () => {
        const page = new ProfilePage({} as never)

        try {
            clickItem(page, 'Appearance')

            expect(page.element?.querySelector<HTMLInputElement>('[data-testid="theme-system"]')?.hasAttribute('checked')).to.be.true
            expect(page.element?.querySelector<HTMLInputElement>('[data-testid="theme-dark"]')?.hasAttribute('checked')).to.be.false
        } finally {
            page.destroy()
        }
    })

    it('applies the dark theme live and persists the choice', () => {
        const page = new ProfilePage({} as never)

        try {
            clickItem(page, 'Appearance')

            const dark = page.element?.querySelector<HTMLInputElement>('[data-testid="theme-dark"]')

            dark?.dispatchEvent(new dom.window.Event('change', { bubbles: true }))

            expect(document.documentElement.dataset.theme).to.equal('dark')
            expect(window.localStorage.getItem('chatty-theme')).to.equal('dark')
            expect(page.element?.querySelector('[data-testid="theme-dark"]')?.hasAttribute('checked')).to.be.true
            expect(page.element?.querySelector('[data-testid="theme-system"]')?.hasAttribute('checked')).to.be.false
        } finally {
            page.destroy()
        }
    })

    it('returns to the light theme and clears the dataset marker', () => {
        const page = new ProfilePage({} as never)

        try {
            clickItem(page, 'Appearance')

            page.element?.querySelector<HTMLInputElement>('[data-testid="theme-dark"]')
                ?.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
            page.element?.querySelector<HTMLInputElement>('[data-testid="theme-light"]')
                ?.dispatchEvent(new dom.window.Event('change', { bubbles: true }))

            expect(document.documentElement.dataset.theme).to.be.undefined
            expect(window.localStorage.getItem('chatty-theme')).to.equal('light')
        } finally {
            page.destroy()
        }
    })
})

describe('settings notification section', () => {
    const originalNotification = (globalThis as { Notification?: typeof Notification }).Notification

    beforeEach(() => {
        setProfileController(controller)
        store.set('user', { ...user })
        window.localStorage.removeItem('chatty-preferences')
        initPreferences()
    })

    afterEach(() => {
        sinon.restore()
        if (originalNotification === undefined) {
            delete (globalThis as { Notification?: unknown }).Notification
        } else {
            ;(globalThis as { Notification?: typeof Notification }).Notification = originalNotification
        }
        store.set('user', undefined)
        store.set('chats', undefined)
        window.localStorage.removeItem('chatty-preferences')
        initPreferences()
    })

    it('toggles the sound preference off', () => {
        const page = new ProfilePage({} as never)

        try {
            clickItem(page, 'Notification')

            expect(getPreferences().sound).to.be.true

            click(page.element?.querySelector('[data-testid="toggle-sound"]'))

            expect(getPreferences().sound).to.be.false
            expect(page.element?.querySelector('[data-testid="toggle-sound"]')?.hasAttribute('checked')).to.be.false
        } finally {
            page.destroy()
        }
    })

    it('explains the missing Notification API (stub-safe jsdom)', () => {
        const page = new ProfilePage({} as never)

        try {
            clickItem(page, 'Notification')

            expect(page.element?.querySelector('[data-testid="notifications-hint"]')?.textContent)
                .to.contain('не поддерживаются')
        } finally {
            page.destroy()
        }
    })

    it('enables browser notifications and requests the permission', async () => {
        const requestPermission = sinon.spy(() => Promise.resolve('granted' as NotificationPermission))

        class FakeNotification {
            static permission = 'default' as NotificationPermission

            static requestPermission(): Promise<NotificationPermission> {
                return requestPermission()
            }
        }

        ;(globalThis as { Notification?: unknown }).Notification = FakeNotification

        const page = new ProfilePage({} as never)

        try {
            clickItem(page, 'Notification')

            click(page.element?.querySelector('[data-testid="toggle-browser-notifications"]'))

            expect(getPreferences().browserNotifications).to.be.true
            expect(requestPermission.calledOnce).to.be.true

            await flush()

            expect(page.element?.querySelector('[data-testid="toggle-browser-notifications"]')?.hasAttribute('checked')).to.be.true
        } finally {
            page.destroy()
        }
    })

    it('disables browser notifications without touching the permission', () => {
        const requestPermission = sinon.spy(() => Promise.resolve('granted' as NotificationPermission))

        class FakeNotification {
            static permission = 'granted' as NotificationPermission

            static requestPermission(): Promise<NotificationPermission> {
                return requestPermission()
            }
        }

        ;(globalThis as { Notification?: unknown }).Notification = FakeNotification

        setPreference('browserNotifications', true)

        const page = new ProfilePage({} as never)

        try {
            clickItem(page, 'Notification')

            click(page.element?.querySelector('[data-testid="toggle-browser-notifications"]'))

            expect(getPreferences().browserNotifications).to.be.false
            expect(requestPermission.called).to.be.false
        } finally {
            page.destroy()
        }
    })
})

describe('settings privacy section', () => {
    beforeEach(() => {
        setProfileController(controller)
        store.set('user', { ...user })
        window.localStorage.removeItem('chatty-preferences')
        initPreferences()
    })

    afterEach(() => {
        sinon.restore()
        store.set('user', undefined)
        store.set('chats', undefined)
        window.localStorage.removeItem('chatty-preferences')
        initPreferences()
    })

    it('sends the single-field PATCH through the profile controller', () => {
        const changeUserInfo = sinon.stub(controller, 'changeUserInfo').resolves()
        const page = new ProfilePage({} as never)

        try {
            clickItem(page, 'Privacy')

            expect(page.element?.querySelector('[data-testid="toggle-read-receipts"]')?.hasAttribute('checked')).to.be.true

            click(page.element?.querySelector('[data-testid="toggle-read-receipts"]'))

            expect(changeUserInfo.calledOnceWith({ send_read_receipts: false })).to.be.true
        } finally {
            page.destroy()
        }
    })

    it('flips the toggle when the refreshed store user arrives', () => {
        sinon.stub(controller, 'changeUserInfo').callsFake(async () => {
            store.set('user', { ...user, send_read_receipts: false })
        })

        const page = new ProfilePage({} as never)

        try {
            clickItem(page, 'Privacy')

            click(page.element?.querySelector('[data-testid="toggle-read-receipts"]'))

            expect(page.element?.querySelector('[data-testid="toggle-read-receipts"]')?.hasAttribute('checked')).to.be.false
        } finally {
            page.destroy()
        }
    })
})

describe('settings data usage section', () => {
    beforeEach(() => {
        setProfileController(controller)
        store.set('user', { ...user })
        window.localStorage.removeItem('chatty-preferences')
        initPreferences()
    })

    afterEach(() => {
        sinon.restore()
        store.set('user', undefined)
        store.set('chats', undefined)
        window.localStorage.removeItem('chatty-preferences')
        initPreferences()
    })

    it('fetches the usage on section entry and renders it human-readable', async () => {
        const fetchUsage = sinon.stub(controller, 'fetchUsage')
            .resolves({ total_bytes: 5 * 1024 * 1024, file_count: 7 })

        const page = new ProfilePage({} as never)

        try {
            clickItem(page, 'Data Usage')

            expect(fetchUsage.calledOnce).to.be.true

            await flush()

            const summary = page.element?.querySelector('[data-testid="usage-summary"]')?.textContent ?? ''

            expect(summary).to.contain('5 МБ')
            expect(summary).to.contain('7')
        } finally {
            page.destroy()
        }
    })

    it('does not refetch on re-renders inside the section', async () => {
        const fetchUsage = sinon.stub(controller, 'fetchUsage')
            .resolves({ total_bytes: 2048, file_count: 1 })

        const page = new ProfilePage({} as never)

        try {
            clickItem(page, 'Data Usage')

            await flush()

            click(page.element?.querySelector('[data-testid="toggle-auto-download"]'))

            expect(fetchUsage.calledOnce).to.be.true
        } finally {
            page.destroy()
        }
    })

    it('shows the failure hint when the request fails', async () => {
        sinon.stub(controller, 'fetchUsage').resolves(undefined)

        const page = new ProfilePage({} as never)

        try {
            clickItem(page, 'Data Usage')

            await flush()

            expect(page.element?.querySelector('[data-testid="usage-error"]')?.textContent)
                .to.contain('Не удалось получить данные')
        } finally {
            page.destroy()
        }
    })

    it('toggles the auto-download preference', () => {
        const page = new ProfilePage({} as never)

        try {
            clickItem(page, 'Data Usage')

            expect(getPreferences().autoDownload).to.be.true

            click(page.element?.querySelector('[data-testid="toggle-auto-download"]'))

            expect(getPreferences().autoDownload).to.be.false
        } finally {
            page.destroy()
        }
    })
})

describe('formatUsageSize', () => {
    it('formats bytes through КБ/МБ/ГБ with a 1024 threshold', () => {
        expect(formatUsageSize(0)).to.equal('0 Б')
        expect(formatUsageSize(512)).to.equal('512 Б')
        expect(formatUsageSize(2048)).to.equal('2 КБ')
        expect(formatUsageSize(1536)).to.equal('1.5 КБ')
        expect(formatUsageSize(5 * 1024 * 1024)).to.equal('5 МБ')
        expect(formatUsageSize(768 * 1024 * 1024)).to.equal('768 МБ')
        expect(formatUsageSize(3 * 1024 ** 3)).to.equal('3 ГБ')
    })

    it('degrades non-finite and negative values to zero', () => {
        expect(formatUsageSize(Number.NaN)).to.equal('0 Б')
        expect(formatUsageSize(-10)).to.equal('0 Б')
    })
})

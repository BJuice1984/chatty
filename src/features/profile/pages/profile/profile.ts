// Фича-страница настроек (stage 4; 2026-11-01-settings — шесть живых секций):
// пункты сайдбара ведут правую панель (section-состояние в пропсах страницы).
// Account — правка display_name/phone (Form-идиома), read-only email/login —
// плоской разметкой (контракт Form/Input read-only не рисует), смена пароля
// (12+ политика + совпадение повтора), «Sign out» и «Sign out everywhere» за
// модалкой-подтверждением; Chats — архив с «Вернуться» (rejoin через шов
// контроллера профиля, карточка оживает рефетчем стора); Appearance — радио
// light/dark/system на utils/theme.ts (применяется сразу); Notification —
// тумблеры звука и браузерных уведомлений (разрешение запрашивается при
// включении, stub-safe); Privacy — серверный флаг send_read_receipts одно-
// полевым PUT; Data Usage — GET /files/usage при входе в секцию + тумблер
// автозагрузки. Контент модалки строит escapeHtml-билдер (узор Messenger).
// 2026-11-02-ui-ux: мобильная навигация — выбор пункта открывает панель
// секции (chat_pane-open на корне, <768), кнопка «назад» возвращает к
// списку пунктов, сохраняя текущую секцию; на десктопе модификатор инертен.

import Block from '../../../../core/Block.ts'
import Handlebars from 'handlebars'
import template from './profile.hbs'
import {
    emptyValidationMessage,
    passwordValidationMessage,
    phoneValidationMessage,
} from '../../../../utils/constants.ts'
import {
    emptyValidator,
    passwordValidator,
    phoneValidator,
} from '../../../../utils/validators.ts'
import { AppState, ComponentProps, withStore } from '../../../../utils/Store.ts'
import type { Button, ChangeUserData, ChatInfo, Input } from '../../../../utils/types.ts'
import { getPreferences, notificationPermission, setPreference } from '../../../../utils/preferences.ts'
import { type Theme, getTheme, setTheme } from '../../../../utils/theme.ts'
import { getProfileController } from '../../controller.ts'
import { profileSlice } from '../../store.ts'
import type { FilesUsage } from '../../ports.ts'

export type SettingsSection = 'account' | 'chats' | 'appearance' | 'notification' | 'privacy' | 'data'

interface ProfilePageUser {
    first_name: string
    second_name: string
    login: string
    phone: string
    email: string
    display_name: string
    avatar: string
    send_read_receipts: boolean
}

interface ProfilePageProps {
    section: SettingsSection
    // мобильное переключение (<768): панель секции открыта (chat_pane-open)
    settingsPaneOpen?: boolean
    // возврат к списку пунктов (кнопка «назад» в панели секции)

    onSettingsBack?: () => void
    user: ProfilePageUser
    archivedChats: ChatInfo[]
    inputs: Input[]
    buttons: Button<ChangeUserData>[]
    passwordInputs: Input[]
    passwordButtons: Button<Record<string, string>>[]
    themeChoice: Theme
    soundEnabled: boolean
    notificationsEnabled: boolean
    autoDownloadEnabled: boolean
    // undefined — ещё грузится, null — запрос не удался
    usage: FilesUsage | null | undefined
    passwordFeedback: string
    logoutAllOpen: boolean
    [key: string]: unknown
}

// Человекочитаемый размер хранилища: Б → КБ → МБ → ГБ (порог 1024), одна
// десятая у дробных величин без хвостовых нулей
export function formatUsageSize(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes < 0) {
        return '0 Б'
    }

    const units = ['Б', 'КБ', 'МБ', 'ГБ']
    let value = bytes
    let unitIndex = 0

    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024
        unitIndex += 1
    }

    const text = Number.isInteger(value) ? String(value) : String(Math.round(value * 10) / 10)

    return `${text} ${units[unitIndex]}`
}

// Экранирование значений в слот-HTML модалок: объекты не строковируем
// (no-base-to-string), примитивы — через строку, остальное — пусто
const escapeHtml = (value: unknown): string => Handlebars.escapeExpression(
    typeof value === 'string' || typeof value === 'number' ? String(value) : ''
)

// Контент подтверждения «выйти со всех устройств» (узор renderDeleteModalContent):
// логин вьюера экранируется — modal рендерит слот без экранирования
export function renderLogoutAllModalContent(login: unknown): string {
    return ''
        + '<div class="modal__confirm-flow">'
        + `<p class="modal__text" data-testid="logout-all-text">Выйти со всех устройств «${escapeHtml(login)}»? `
        + 'Остальные сессии будут завершены, эта останется активной.</p>'
        + '<div class="modal__actions">'
        + '<button type="button" class="modal__button modal__button_danger" data-testid="logout-all-confirm">Выйти со всех</button>'
        + '<button type="button" class="modal__button" data-testid="logout-all-cancel">Отмена</button>'
        + '</div>'
        + '</div>'
}

// Запрос разрешения браузера при включении тумблера: API может отсутствовать
// (jsdom/старые сборки) — тихо пропускаем, доставка уведомлений дополнительно
// проверяет разрешение в момент события
function requestBrowserPermission(): Promise<void> {
    const api = (globalThis as { Notification?: { requestPermission?: () => Promise<NotificationPermission> } }).Notification

    if (api == null || typeof api.requestPermission !== 'function') {
        return Promise.resolve()
    }

    return Promise.resolve(api.requestPermission()).then(() => {}, () => {})
}

// Телефон на собственном бэкенде опционален (NULL разрешён): пустое поле —
// валидно, заполненное — прежним форматным валидатором
const optionalPhoneValidator = (value: string): boolean => value === '' || phoneValidator(value)

class ProfilePageBase extends Block<ProfilePageProps> {
    constructor(propsFromStore: { user: ProfilePageUser, archivedChats: ChatInfo[] }) {
        super({
            ...(propsFromStore as unknown as ProfilePageProps),
            // UI-состояние секций и тумблеров — controller-free пропсы страницы
            section: 'account',
            // мобильное переключение (<768): true — показана панель секции,
            // список пунктов скрыт (модификатор корня chat_pane-open в hbs)
            settingsPaneOpen: false,
            themeChoice: getTheme(),
            soundEnabled: getPreferences().sound,
            notificationsEnabled: getPreferences().browserNotifications,
            autoDownloadEnabled: getPreferences().autoDownload,
            usage: undefined,
            passwordFeedback: '',
            logoutAllOpen: false,
            onUserAvatar: (data: FormData) => {
                void getProfileController().changeUserAvatar(data)
            },
            user: {
                first_name: propsFromStore.user.first_name,
                second_name: propsFromStore.user.second_name,
                login: propsFromStore.user.login,
                phone: propsFromStore.user.phone,
                email: propsFromStore.user.email,
                display_name: propsFromStore.user.display_name,
                avatar: propsFromStore.user.avatar,
                send_read_receipts: propsFromStore.user.send_read_receipts,
            },
            archivedChats: propsFromStore.archivedChats ?? [],
            inputs: [
                {
                    label: 'Display Name',
                    name: 'display_name',
                    validate: emptyValidator,
                    validateMessage: emptyValidationMessage,
                },
                {
                    label: 'Phone Number',
                    name: 'phone',
                    validate: optionalPhoneValidator,
                    validateMessage: phoneValidationMessage,
                },
            ],
            buttons: [
                {
                    label: 'Submit changes',
                    classType: 'disabled',
                    type: 'submit',
                    // 2026-11-07-messenger-ux-pack-2: кнопка спит, пока в
                    // форме нет изменений или есть ошибка валидации —
                    // оживляет делегированный input-листенер страницы
                    disabled: true,
                    handleSubmitClick: (value: ChangeUserData) => {
                        void getProfileController().changeUserInfo(value)
                    },
                },
                {
                    label: 'Sign out',
                    classType: 'danger',
                    type: 'button',
                    onClick: () => {
                        void getProfileController().logout()
                    },
                },
            ],
            passwordInputs: [
                {
                    label: 'Старый пароль',
                    name: 'old_password',
                    validate: emptyValidator,
                    validateMessage: emptyValidationMessage,
                },
                {
                    label: 'Новый пароль',
                    name: 'new_password',
                    validate: passwordValidator,
                    validateMessage: passwordValidationMessage,
                },
                {
                    label: 'Повторите новый пароль',
                    name: 'repeat_password',
                    validate: passwordValidator,
                    validateMessage: passwordValidationMessage,
                },
            ],
            passwordButtons: [
                {
                    label: 'Change password',
                    classType: 'secondary',
                    type: 'submit',
                    // спит до валидного и непустого набора полей
                    disabled: true,
                    handleSubmitClick: (value: Record<string, string>) => {
                        this.handleSubmitPassword(value)
                    },
                },
            ],
            onSelectAccount: () => {
                this.selectSection('account')
            },
            onSelectChats: () => {
                this.selectSection('chats')
            },
            onSelectAppearance: () => {
                this.selectSection('appearance')
            },
            onSelectNotification: () => {
                this.selectSection('notification')
            },
            onSelectPrivacy: () => {
                this.selectSection('privacy')
            },
            onSelectData: () => {
                this.selectSection('data')
            },
            onCloseLogoutAll: () => {
                this.setProps({ logoutAllOpen: false })
            },
            // возврат к списку пунктов в мобильном переключении (<768):
            // секция сохраняется — повторный тап того же пункта мгновенно
            // переоткрывает панель
            onSettingsBack: () => {
                this.setProps({ settingsPaneOpen: false })
            },
            // делегирование с корня страницы (узор Messenger/Contacts): сырые
            // узлы секций (тумблеры, «Вернуться», кнопки модалки) не дотягиваются
            // пропсами — слушатели переживают перерисовки
            events: {
                // 2026-11-07-messenger-ux-pack-2: живой гейт submit-кнопок —
                // пересчёт на каждое нажатие, без перерисовки (фокус и
                // черновик формы не страдают; store-эмит пересеивает форму
                // и кнопки согласованно — reset-семантика F-4)
                input: () => {
                    this.updateSubmitButtons()
                },
                click: (event: Event) => {
                    const target = event.target as HTMLElement | null

                    // кнопка «назад» мобильной панели — сырой <button> в
                    // profile.hbs, колбэк читается из this.props на момент
                    // клика (узор messenger-back)
                    if (target?.closest('[data-testid="settings-back"]') != null) {
                        (this.props).onSettingsBack?.()

                        return
                    }

                    if (target?.closest('[data-testid="logout-all-open"]') != null) {
                        this.setProps({ logoutAllOpen: true })

                        return
                    }

                    if (target?.closest('[data-testid="logout-all-cancel"]') != null) {
                        this.setProps({ logoutAllOpen: false })

                        return
                    }

                    if (target?.closest('[data-testid="logout-all-confirm"]') != null) {
                        this.setProps({ logoutAllOpen: false })
                        void getProfileController().logoutAll()

                        return
                    }

                    const rejoinButton = target?.closest<HTMLButtonElement>('[data-testid="rejoin-chat"]')

                    if (rejoinButton != null) {
                        const chatId = Number(rejoinButton.dataset.chatId)

                        if (Number.isInteger(chatId)) {
                            getProfileController().rejoinChat(chatId)
                        }

                        return
                    }

                    if (target?.closest('[data-testid="toggle-sound"]') != null) {
                        const next = !getPreferences().sound

                        setPreference('sound', next)
                        this.setProps({ soundEnabled: next })

                        return
                    }

                    if (target?.closest('[data-testid="toggle-auto-download"]') != null) {
                        const next = !getPreferences().autoDownload

                        setPreference('autoDownload', next)
                        this.setProps({ autoDownloadEnabled: next })

                        return
                    }

                    if (target?.closest('[data-testid="toggle-browser-notifications"]') != null) {
                        this.handleNotificationsToggle()

                        return
                    }

                    if (target?.closest('[data-testid="toggle-read-receipts"]') != null) {
                        const current = this.props.user?.send_read_receipts ?? true

                        // одно поле — частичный PUT: absent-поля колонки не трут
                        void getProfileController().changeUserInfo({ send_read_receipts: !current })
                    }
                },
                // радио темы: применяется сразу (setTheme пишет dataset),
                // локальный пропс синхронизирует атрибут checked при рендере
                change: (event: Event) => {
                    const target = event.target as HTMLInputElement | null

                    if (target?.name !== 'theme-choice') {
                        return
                    }

                    const choice = target.value

                    if (choice === 'light' || choice === 'dark' || choice === 'system') {
                        setTheme(choice)
                        this.setProps({ themeChoice: choice })
                    }
                },
            } as unknown as Record<string, () => void>,
        })
    }

    private selectSection(section: SettingsSection): void {
        // выбор пункта открывает панель секции (мобильное переключение);
        // на десктопе флаг инертен — правила pane-open живут в media <768
        this.setProps({ section, settingsPaneOpen: true })
    }

    // Тумблер браузерных уведомлений: включение сначала спрашивает разрешение
    // (ответ не влияет на предпочтение — гейт доставки сам проверит granted)
    private handleNotificationsToggle(): void {
        const next = !getPreferences().browserNotifications

        setPreference('browserNotifications', next)
        this.setProps({ notificationsEnabled: next })

        if (next) {
            void requestBrowserPermission().then(() => {
                this.setProps({ notificationsEnabled: getPreferences().browserNotifications })
            })
        }
    }

    private handleSubmitPassword(value: Record<string, string>): void {
        if ((value.new_password ?? '') !== (value.repeat_password ?? '')) {
            this.setProps({ passwordFeedback: 'Новые пароли не совпадают' })

            return
        }

        this.setProps({ passwordFeedback: '' })
        void getProfileController().changePassword({
            old_password: value.old_password ?? '',
            new_password: value.new_password ?? '',
        })
    }

    // Живой гейт submit-кнопок форм профиля (2026-11-07-messenger-ux-pack-2):
    // обе спят, пока форма чиста или невалидна. Пересчёт читает DOM напрямую
    // (значения форм живут только там) и переключает атрибуты императивно —
    // БЕЗ setProps/перерисовки, чтобы ввод не терял фокус. Store-эмит
    // пересеивает форму целиком и кнопки возвращаются из дескрипторов
    // (disabled) в том же рендере — согласованно (review F-4)
    private updateSubmitButtons(): void {
        const root = this.element

        if (root == null) {
            return
        }

        const user = profileSlice.getUser()

        // аккаунт-форма: изменения относительно сид-значений профиля
        const displayName = root.querySelector<HTMLInputElement>('input[name="display_name"]')?.value ?? ''
        const phone = root.querySelector<HTMLInputElement>('input[name="phone"]')?.value ?? ''
        const accountDirty = displayName !== (user?.display_name ?? '') || phone !== (user?.phone ?? '')
        const accountValid = emptyValidator(displayName) && optionalPhoneValidator(phone)

        const accountSubmit = root.querySelector<HTMLButtonElement>('[data-testid="account-form"] button[type="submit"]')

        if (accountSubmit != null) {
            accountSubmit.disabled = !(accountDirty && accountValid)
        }

        // форма пароля: непустой старый + валидный новый + совпадающий повтор
        const oldPassword = root.querySelector<HTMLInputElement>('input[name="old_password"]')?.value ?? ''
        const newPassword = root.querySelector<HTMLInputElement>('input[name="new_password"]')?.value ?? ''
        const repeatPassword = root.querySelector<HTMLInputElement>('input[name="repeat_password"]')?.value ?? ''
        const passwordReady = oldPassword !== ''
            && passwordValidator(newPassword)
            && newPassword === repeatPassword

        const passwordSubmit = root.querySelector<HTMLButtonElement>('[data-testid="password-form"] button[type="submit"]')

        if (passwordSubmit != null) {
            passwordSubmit.disabled = !passwordReady
        }
    }

    // Хранилище грузится при ВХОДЕ в секцию (не при каждом рендере) — вторичная
    // навигация и перерисовки тумблеров не дублируют запрос
    private loadUsage(): void {
        void getProfileController().fetchUsage().then(usage => {
            this.setProps({ usage: usage ?? null })
        })
    }

    componentDidMount() {
        if (this.props.section === 'data') {
            this.loadUsage()
        }
    }

    protected componentDidUpdate(oldProps: Record<string, unknown>, newProps: Record<string, unknown>): boolean {
        if ((newProps as ProfilePageProps).section === 'data'
            && (oldProps as ProfilePageProps).section !== 'data') {
            this.loadUsage()
        }

        return true
    }

    render() {
        const props = this.props
        const section = props.section ?? 'account'
        const theme = props.themeChoice ?? getTheme()
        const usage = props.usage
        const permission = notificationPermission()
        const notificationsHint = permission === 'unsupported'
            ? 'Браузерные уведомления не поддерживаются этим браузером'
            : permission === 'denied'
                ? 'Разрешение не выдано — включите уведомления в настройках браузера'
                : permission === 'default'
                    ? 'При включении запросим разрешение у браузера'
                    : ''

        return this.compile(template, {
            ...props,
            section,
            sectionAccount: section === 'account',
            sectionChats: section === 'chats',
            sectionAppearance: section === 'appearance',
            sectionNotification: section === 'notification',
            sectionPrivacy: section === 'privacy',
            sectionData: section === 'data',
            accountActive: section === 'account',
            chatsActive: section === 'chats',
            appearanceActive: section === 'appearance',
            notificationActive: section === 'notification',
            privacyActive: section === 'privacy',
            dataActive: section === 'data',
            themeLight: theme === 'light',
            themeDark: theme === 'dark',
            themeSystem: theme === 'system',
            notificationsHint,
            receiptsEnabled: props.user?.send_read_receipts ?? true,
            usageText: usage != null ? formatUsageSize(usage.total_bytes) : '',
            usageCount: usage?.file_count,
            usageFailed: usage === null,
            logoutAllContent: renderLogoutAllModalContent(props.user?.login),
        })
    }
}

// слайс: пользователь целиком (включая send_read_receipts) + архив чатов
// (leftAt из GET /chats, каст-идиом слайса чатов)
const withUser = withStore((state: AppState): ComponentProps & {
    user: ProfilePageUser
    archivedChats: ChatInfo[]
} => ({
    user: {
        first_name: state.user?.first_name ?? '',
        second_name: state.user?.second_name ?? '',
        email: state.user?.email ?? '',
        login: state.user?.login ?? '',
        phone: state.user?.phone ?? '',
        display_name: state.user?.display_name ?? '',
        avatar: state.user?.avatar ?? '',
        send_read_receipts: state.user?.send_read_receipts ?? true,
    },
    archivedChats: (state.chats ?? [])
        .filter(chat => (chat as ChatInfo).leftAt != null)
        .map(chat => chat as ChatInfo),
}))

export const ProfilePage = withUser(ProfilePageBase as typeof Block)

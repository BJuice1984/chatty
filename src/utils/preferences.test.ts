// Настройки зрителя (2026-11-01-settings): дефолты, персистентность одним
// JSON-блобом (ключ chatty-preferences), живые подписчики, устойчивость к
// отказу localStorage и неизвестным значениям, хелпер состояния разрешения
// уведомлений (API Notification в jsdom нет — проверяем обе ветки заглушкой).

import { expect } from 'chai'
import sinon from 'sinon'
import {
    getPreferences,
    initPreferences,
    notificationPermission,
    setPreference,
    subscribePreferences,
} from './preferences.ts'

const PREFERENCES_STORAGE_KEY = 'chatty-preferences'

const DEFAULTS = {
    sound: true,
    browserNotifications: false,
    autoDownload: true,
}

// сброс между тестами: чистое хранилище + перечитанное состояние модуля
function resetPreferences(): void {
    window.localStorage.removeItem(PREFERENCES_STORAGE_KEY)
    initPreferences()
}

describe('preferences', () => {
    afterEach(() => {
        sinon.restore()
        resetPreferences()
    })

    it('defaults: sound on, browser notifications off, auto-download on', () => {
        resetPreferences()

        expect(getPreferences()).to.deep.eq(DEFAULTS)
    })

    it('persists changes as one JSON blob and restores them through init', () => {
        setPreference('sound', false)
        setPreference('autoDownload', false)

        expect(window.localStorage.getItem(PREFERENCES_STORAGE_KEY)).to.eq(
            JSON.stringify({ sound: false, browserNotifications: false, autoDownload: false })
        )

        // «перезагрузка»: состояние перечитано из хранилища
        initPreferences()

        expect(getPreferences()).to.deep.eq({
            sound: false,
            browserNotifications: false,
            autoDownload: false,
        })
    })

    it('returns a copy: mutating the result does not leak into the module', () => {
        const snapshot = getPreferences()

        snapshot.sound = false

        expect(getPreferences().sound).to.be.true
    })

    it('notifies subscribers with the fresh values on set and stops after unsubscribe', () => {
        const listener = sinon.spy()
        const unsubscribe = subscribePreferences(listener)

        setPreference('browserNotifications', true)

        expect(listener.calledOnce).to.be.true
        expect(listener.firstCall.args).to.deep.eq([{
            sound: true,
            browserNotifications: true,
            autoDownload: true,
        }])

        unsubscribe()

        setPreference('sound', false)

        expect(listener.calledOnce).to.be.true
    })

    it('falls back per field for wrongly-typed stored values, keeping valid ones', () => {
        window.localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify({
            sound: 'yes',
            browserNotifications: true,
            autoDownload: 1,
        }))

        initPreferences()

        expect(getPreferences()).to.deep.eq({
            sound: true,
            browserNotifications: true,
            autoDownload: true,
        })
    })

    it('falls back to the defaults entirely for a corrupt blob', () => {
        window.localStorage.setItem(PREFERENCES_STORAGE_KEY, '{not json')

        initPreferences()

        expect(getPreferences()).to.deep.eq(DEFAULTS)
    })

    it('tolerates a failing storage on both read and write', () => {
        sinon.stub(window.localStorage, 'getItem').throws(new Error('unavailable'))
        sinon.stub(window.localStorage, 'setItem').throws(new Error('unavailable'))

        expect(() => initPreferences()).to.not.throw()
        expect(getPreferences()).to.deep.eq(DEFAULTS)

        expect(() => setPreference('sound', false)).to.not.throw()

        // значение живёт в памяти даже без персистентности
        expect(getPreferences().sound).to.be.false
    })

    it('exposes the permission state when the Notification API exists and unsupported otherwise', () => {
        const globals = globalThis as { Notification?: unknown }
        const original = globals.Notification

        globals.Notification = { permission: 'granted' }

        expect(notificationPermission()).to.eq('granted')

        delete globals.Notification

        expect(notificationPermission()).to.eq('unsupported')

        globals.Notification = original
    })
})

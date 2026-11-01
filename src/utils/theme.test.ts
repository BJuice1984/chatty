// Тема оформления: светлая/тёмная/системная. Проверяем контракт для настроек:
// персистентность в localStorage (ключ chatty-theme), подписку на системную
// схему только в режиме system, мутацию dataset.theme на <html> и устойчивость
// к недоступному storage. jsdom не реализует matchMedia — ставим заглушку.

import { expect } from 'chai'
import sinon from 'sinon'
import {
    applyTheme,
    getResolvedTheme,
    getTheme,
    initTheme,
    onThemeChange,
    setTheme,
} from './theme.ts'

const THEME_STORAGE_KEY = 'chatty-theme'

type FakeMediaListener = (event: { matches: boolean }) => void

interface FakeMediaQuery {
    matches: boolean
    addEventListener: sinon.SinonSpy
    removeEventListener: sinon.SinonSpy
    emit: (matches: boolean) => void
}

function installMatchMedia(initialMatches: boolean): FakeMediaQuery {
    const listeners = new Set<FakeMediaListener>()
    const query: FakeMediaQuery = {
        matches: initialMatches,
        addEventListener: sinon.spy((_type: string, listener: FakeMediaListener) => {
            listeners.add(listener)
        }),
        removeEventListener: sinon.spy((_type: string, listener: FakeMediaListener) => {
            listeners.delete(listener)
        }),
        emit: (matches: boolean) => {
            query.matches = matches

            for (const listener of listeners) {
                listener({ matches })
            }
        },
    }

    ;(window as unknown as { matchMedia: unknown }).matchMedia = (mediaQuery: string) => {
        expect(mediaQuery).to.equal('(prefers-color-scheme: dark)')

        return query as unknown as MediaQueryList
    }

    return query
}

function currentThemeAttribute(): string | undefined {
    return document.documentElement.dataset.theme
}

function cleanup(): void {
    sinon.restore()
    window.localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
    delete (window as unknown as { matchMedia?: unknown }).matchMedia
}

describe('theme', () => {
    afterEach(cleanup)

    it('initTheme defaults to system (resolving to light) when storage is empty and matchMedia is absent', () => {
        initTheme()

        expect(getTheme()).to.equal('system')
        expect(getResolvedTheme()).to.equal('light')
        expect(currentThemeAttribute()).to.be.undefined
    })

    it('persists the choice under the chatty-theme key and restores it on init', () => {
        installMatchMedia(false)

        setTheme('dark')
        expect(window.localStorage.getItem(THEME_STORAGE_KEY)).to.equal('dark')
        expect(currentThemeAttribute()).to.equal('dark')

        setTheme('light')
        expect(window.localStorage.getItem(THEME_STORAGE_KEY)).to.equal('light')
        expect(currentThemeAttribute()).to.be.undefined

        window.localStorage.setItem(THEME_STORAGE_KEY, 'dark')
        initTheme()
        expect(getTheme()).to.equal('dark')
        expect(currentThemeAttribute()).to.equal('dark')
    })

    it('applies the data-theme dataset only for the dark resolution', () => {
        applyTheme('dark')
        expect(currentThemeAttribute()).to.equal('dark')

        applyTheme('light')
        expect(currentThemeAttribute()).to.be.undefined
    })

    it('follows the system preference in system mode', () => {
        const query = installMatchMedia(true)

        setTheme('system')
        expect(currentThemeAttribute()).to.equal('dark')

        query.emit(false)
        expect(currentThemeAttribute()).to.be.undefined
        expect(getResolvedTheme()).to.equal('light')

        query.emit(true)
        expect(currentThemeAttribute()).to.equal('dark')
        expect(getResolvedTheme()).to.equal('dark')
    })

    it('keeps the matchMedia change listener attached only in system mode', () => {
        const query = installMatchMedia(false)

        setTheme('system')
        expect(query.addEventListener.calledOnce).to.be.true
        expect(query.addEventListener.firstCall.args[0]).to.equal('change')

        setTheme('dark')
        expect(query.removeEventListener.calledOnce).to.be.true
        expect(query.removeEventListener.firstCall.args[0]).to.equal('change')

        setTheme('system')
        expect(query.addEventListener.calledTwice).to.be.true

        query.emit(true)
        expect(currentThemeAttribute()).to.equal('dark')
    })

    it('ignores a system flip while an explicit theme is active', () => {
        const query = installMatchMedia(true)

        setTheme('light')
        query.emit(false)
        query.emit(true)

        expect(currentThemeAttribute()).to.be.undefined
        expect(getResolvedTheme()).to.equal('light')
    })

    it('notifies subscribers on every applied change and stops after unsubscribe', () => {
        installMatchMedia(false)
        initTheme()

        const listener = sinon.spy()
        const unsubscribe = onThemeChange(listener)

        setTheme('dark')
        expect(listener.calledOnce).to.be.true
        expect(listener.firstCall.args).to.deep.equal(['dark', 'dark'])

        unsubscribe()
        setTheme('light')
        expect(listener.calledOnce).to.be.true
    })

    it('tolerates localStorage failures without throwing', () => {
        sinon.stub(window.localStorage, 'getItem').throws(new Error('unavailable'))
        sinon.stub(window.localStorage, 'setItem').throws(new Error('unavailable'))

        initTheme()
        expect(getTheme()).to.equal('system')

        setTheme('dark')
        expect(getTheme()).to.equal('dark')
        expect(currentThemeAttribute()).to.equal('dark')
    })
})

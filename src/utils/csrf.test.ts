import { expect } from 'chai'
import { JSDOM } from 'jsdom'
import { OWN_CSRF_COOKIE_NAME, readCookie, readCsrfToken } from './csrf.ts'

const dom = new JSDOM()
global.document = dom.window.document

function setCookie(raw: string): void {
    Object.defineProperty(document, 'cookie', {
        configurable: true,
        writable: true,
        value: raw,
    })
}

describe('csrf cookie reader', () => {
    it('should read the own-mode csrf cookie value', () => {
        setCookie(`${OWN_CSRF_COOKIE_NAME}=token-1; other=value`)

        expect(readCsrfToken()).to.eq('token-1')
    })

    it('should return an empty string when the cookie is absent', () => {
        setCookie('other=value')

        expect(readCookie(OWN_CSRF_COOKIE_NAME)).to.eq('')
        expect(readCookie('missing')).to.eq('')
    })

    it('should decode encoded values and trim spaces around keys', () => {
        setCookie(` first=${encodeURIComponent('a b')};  ${OWN_CSRF_COOKIE_NAME}=second`)

        expect(readCookie('first')).to.eq('a b')
        expect(readCookie(OWN_CSRF_COOKIE_NAME)).to.eq('second')
    })

    it('should tolerate entries without a separator', () => {
        setCookie('broken; a=1')

        expect(readCookie('a')).to.eq('1')
        expect(readCookie('broken')).to.eq('')
    })
})

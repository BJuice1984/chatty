// Регрессионные тесты валидаторов форм (LIVE-2): собственный email-контракт —
// точки/дефисы/плюсы в локальной части и толерантность к пробелам копипаста.

import { expect } from 'chai'
import {
    emptyValidator,
    loginValidator,
    mailValidator,
    passwordValidator,
} from './validators.ts'

describe('validators', () => {
    it('accepts dots, dashes, plus and percent in the email local part (LIVE-2)', () => {
        expect(mailValidator('manual.smoke2@example.com')).to.be.true
        expect(mailValidator('first.last+tag@sub.domain.io')).to.be.true
        expect(mailValidator('a%b@example.com')).to.be.true
    })

    it('tolerates copy-paste spaces around the email (LIVE-2)', () => {
        expect(mailValidator('  manual.smoke2@example.com ')).to.be.true
        expect(mailValidator('\tmanual.smoke2@example.com\n')).to.be.true
    })

    it('still rejects broken emails', () => {
        expect(mailValidator('manual.smoke2')).to.be.false
        expect(mailValidator('@example.com')).to.be.false
        expect(mailValidator('a@b')).to.be.false
        expect(mailValidator('   ')).to.be.false
    })

    it('keeps the login validator word-only (profile form)', () => {
        expect(loginValidator('ada_lovelace-1')).to.be.true
        expect(loginValidator('ab')).to.be.false
        expect(loginValidator('не латиница')).to.be.false
    })

    it('requires an uppercase letter and a digit in the password', () => {
        expect(passwordValidator('LongPassword1')).to.be.true
        expect(passwordValidator('longpassword1')).to.be.false
        expect(passwordValidator('LongPassword')).to.be.false
    })

    it('enforces the own-contract password minimum of 12 characters', () => {
        expect(passwordValidator('Short1pw')).to.be.false
        expect(passwordValidator('A1')).to.be.false
        expect(passwordValidator('TwelveChars1')).to.be.true
        expect(passwordValidator('Exactly-12-Chars9')).to.be.true
    })

    it('rejects blank values in required fields', () => {
        expect(emptyValidator('   ')).to.be.false
        expect(emptyValidator('текст')).to.be.true
    })
})

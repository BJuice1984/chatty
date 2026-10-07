import { expect } from 'chai'
import { documentDownloadUrl, UnsafeDocumentUrlError } from './safety.ts'
import type { AppEnvironment } from '../../utils/env.ts'

const configuration: AppEnvironment = {
    mode: 'own',
    apiUrl: 'http://localhost:8000/api/v1',
    wsUrl: 'ws://localhost:8000',
    filesUrl: 'http://localhost:8000/files',
    csrfHeaderName: 'X-CSRF-Token',
}

describe('ai assistant document url safety', () => {
    it('builds the download url from a positive integer file id', () => {
        expect(documentDownloadUrl(42, configuration)).to.eq(
            'http://localhost:8000/api/v1/files/42/download'
        )
    })

    it('rejects scheme-carrying pseudo ids', () => {
        expect(() => documentDownloadUrl('javascript:alert(1)', configuration)).to.throw(
            UnsafeDocumentUrlError
        )
        expect(() => documentDownloadUrl('data:text/html;base64,xxx', configuration)).to.throw(
            UnsafeDocumentUrlError
        )
    })

    it('rejects non-integer, non-positive and non-numeric ids', () => {
        for (const unsafe of ['42', 0, -7, 3.5, null, undefined, {}, NaN, true]) {
            expect(() => documentDownloadUrl(unsafe, configuration), String(unsafe)).to.throw(
                UnsafeDocumentUrlError
            )
        }
    })

    it('never returns a foreign origin', () => {
        for (let id = 1; id <= 5; id += 1) {
            const url = new URL(documentDownloadUrl(id, configuration))

            expect(url.origin).to.eq('http://localhost:8000')
            expect(url.protocol).to.eq('http:')
        }
    })
})

import { expect } from 'chai'
import { EnvironmentError, fileUrl, joinUrl, readEnv } from './env.ts'

const ownEnvironment = readEnv({
    VITE_API_URL: 'http://localhost:8000/api/v1/',
    VITE_WS_URL: 'ws://localhost:8000/api/v1/',
    VITE_FILES_URL: 'http://localhost:8000/api/v1/files/',
})

describe('environment boundary', () => {
    it('should fall back to local own-stack defaults when VITE_ vars are absent', () => {
        // Один режим — собственный бэкенд: dev/тесты без переменных получают
        // локальные дефолты compose-стека, а не ошибку старта
        expect(readEnv({})).to.deep.eq({
            apiUrl: 'http://localhost:8000/api/v1',
            wsUrl: 'ws://localhost:8000/api/v1',
            filesUrl: 'http://localhost:8000/api/v1/files',
            csrfHeaderName: 'X-CSRF-Token',
        })
    })

    it('should prefer configured VITE_ values over the defaults', () => {
        const environment = readEnv({
            VITE_API_URL: 'https://api.example.test/v1',
            VITE_WS_URL: 'wss://api.example.test/v1',
            VITE_FILES_URL: 'https://cdn.example.test/files',
            VITE_CSRF_HEADER_NAME: 'X-Csrf-Token',
        })

        expect(environment.apiUrl).to.equal('https://api.example.test/v1')
        expect(environment.wsUrl).to.equal('wss://api.example.test/v1')
        expect(environment.filesUrl).to.equal('https://cdn.example.test/files')
        expect(environment.csrfHeaderName).to.equal('X-Csrf-Token')
    })

    it('should reject invalid URLs, protocols and CSRF header names', () => {
        expect(() => readEnv({ VITE_API_URL: 'not a url' })).to.throw(EnvironmentError)
        expect(() => readEnv({ VITE_API_URL: 'ftp://example.test' })).to.throw(EnvironmentError)
        expect(() => readEnv({ VITE_WS_URL: 'http://example.test' })).to.throw(EnvironmentError)
        expect(() => readEnv({ VITE_CSRF_HEADER_NAME: '1 bad' })).to.throw(EnvironmentError)
    })

    it('should join configured URLs without duplicate separators', () => {
        expect(joinUrl('http://localhost:8000/api/v1/', '/users')).to.equal(
            'http://localhost:8000/api/v1/users',
        )
        expect(fileUrl('/avatars/user.png', ownEnvironment)).to.equal(
            'http://localhost:8000/api/v1/files/avatars/user.png',
        )
    })

    it('should reject absolute and traversal paths', () => {
        expect(() => joinUrl('https://example.test/api', 'https://other.test/path')).to.throw(
            EnvironmentError,
        )
        expect(() => joinUrl('https://example.test/api', '../private')).to.throw(EnvironmentError)
    })
})

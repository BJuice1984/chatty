import { expect } from 'chai'
import {
    EnvironmentError,
    chatWebSocketUrl,
    fileUrl,
    joinUrl,
    readEnv,
    resolveMode,
} from './env'

const ownEnvironment = readEnv({
    MODE: 'own',
    VITE_API_URL: 'http://localhost:8000/api/v1/',
    VITE_WS_URL: 'ws://localhost:8000/api/v1/',
    VITE_FILES_URL: 'http://localhost:8000/api/v1/files/',
})

describe('environment boundary', () => {
    it('should resolve the Practicum mode from the Vite development mode', () => {
        expect(resolveMode({ MODE: 'development' })).to.equal('practicum')
        expect(resolveMode({ VITE_APP_MODE: 'practicum' })).to.equal('practicum')
    })

    it('should resolve the own mode from an explicit Vite mode', () => {
        expect(resolveMode({ MODE: 'own' })).to.equal('own')
        expect(resolveMode({ VITE_APP_MODE: 'own' })).to.equal('own')
    })

    it('should reject an unsupported mode and missing own endpoint', () => {
        expect(() => resolveMode({ MODE: 'staging' })).to.throw(EnvironmentError)
        expect(() => readEnv({ MODE: 'own' })).to.throw('Missing required environment value')
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

    it('should build the compatibility WebSocket URL from the configured origin', () => {
        expect(chatWebSocketUrl(7, 42, 'token/with spaces', ownEnvironment)).to.equal(
            'ws://localhost:8000/api/v1/ws/chats/7/42/token%2Fwith%20spaces',
        )
    })
})

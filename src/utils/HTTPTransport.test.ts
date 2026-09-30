import { expect } from 'chai'
import sinon from 'sinon'
import HTTPTransport, { TransportError } from './HTTPTransport'
import { readEnv } from './env'

const testEnvironment = readEnv({
    MODE: 'own',
    VITE_API_URL: 'http://localhost:8000/api/v1/',
    VITE_WS_URL: 'ws://localhost:8000/api/v1/',
    VITE_FILES_URL: 'http://localhost:8000/api/v1/files/',
    VITE_CSRF_HEADER_NAME: 'X-CSRF-Token',
})

describe('HTTPTransport', () => {
    describe('URL construction', () => {
        it('should use the configured base URL for GET requests', () => {
            const transport = new HTTPTransport('/test-endpoint', testEnvironment)
            const requestStub = sinon.stub(transport, 'request' as keyof HTTPTransport)

            transport.get('/resource')

            expect(requestStub.calledWith('http://localhost:8000/api/v1/test-endpoint/resource', {
                method: 'GET',
            })).to.be.true
        })

        it('should use the configured base URL for PUT requests', () => {
            const transport = new HTTPTransport('/test-endpoint', testEnvironment)
            const requestStub = sinon.stub(transport, 'request' as keyof HTTPTransport)

            transport.put('/resource')

            expect(requestStub.calledWith('http://localhost:8000/api/v1/test-endpoint/resource', {
                method: 'PUT',
            })).to.be.true
        })

        it('should use the configured base URL for POST requests', () => {
            const transport = new HTTPTransport('/test-endpoint', testEnvironment)
            const requestStub = sinon.stub(transport, 'request' as keyof HTTPTransport)

            transport.post('/resource')

            expect(requestStub.calledWith('http://localhost:8000/api/v1/test-endpoint/resource', {
                method: 'POST',
            })).to.be.true
        })

        it('should use the configured base URL for DELETE requests', () => {
            const transport = new HTTPTransport('/test-endpoint', testEnvironment)
            const requestStub = sinon.stub(transport, 'request' as keyof HTTPTransport)

            transport.delete('/resource')

            expect(requestStub.calledWith('http://localhost:8000/api/v1/test-endpoint/resource', {
                method: 'DELETE',
            })).to.be.true
        })
    })

    it('should forward an explicit CSRF token for state-changing requests', async () => {
        let request: FakeXMLHttpRequest | undefined
        const originalXMLHttpRequest = globalThis.XMLHttpRequest

        class FakeXMLHttpRequest {
            status = 204
            response: unknown = null
            headers: Record<string, string> = {}
            withCredentials = false
            responseType: XMLHttpRequestResponseType = ''
            timeout = 0
            onload: (() => void) | null = null
            onabort: (() => void) | null = null
            onerror: (() => void) | null = null
            ontimeout: (() => void) | null = null

            open() {}

            setRequestHeader(header: string, value: string) {
                this.headers[header] = value
            }

            send() {
                request = this
                this.onload?.()
            }
        }

        globalThis.XMLHttpRequest = FakeXMLHttpRequest as unknown as typeof XMLHttpRequest

        try {
            await new HTTPTransport('/auth', testEnvironment).post('/logout', {
                csrfToken: 'csrf-value',
            })
        } finally {
            globalThis.XMLHttpRequest = originalXMLHttpRequest
        }

        expect(request?.headers['X-CSRF-Token']).to.equal('csrf-value')
    })

    it('should normalize HTTP errors without depending on ApiError', async () => {
        const originalXMLHttpRequest = globalThis.XMLHttpRequest

        class FakeXMLHttpRequest {
            status = 422
            response = { detail: 'invalid payload' }
            withCredentials = false
            responseType: XMLHttpRequestResponseType = ''
            timeout = 0
            onload: (() => void) | null = null
            onabort: (() => void) | null = null
            onerror: (() => void) | null = null
            ontimeout: (() => void) | null = null

            open() {}

            setRequestHeader() {}

            send() {
                this.onload?.()
            }
        }

        globalThis.XMLHttpRequest = FakeXMLHttpRequest as unknown as typeof XMLHttpRequest

        try {
            await new HTTPTransport('/auth', testEnvironment).post('/login')
            expect.fail('The request should reject')
        } catch (error: unknown) {
            expect(error).to.be.instanceOf(TransportError)
            expect(error).to.have.property('kind', 'http')
            expect(error).to.have.property('status', 422)
            expect(error).to.have.property('message', 'invalid payload')
        } finally {
            globalThis.XMLHttpRequest = originalXMLHttpRequest
        }
    })
})
